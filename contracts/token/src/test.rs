#![cfg(test)]

use crate::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, String, TryIntoVal, Val};

fn setup_contract(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);
    (client, contract_id)
}

fn init_default(env: &Env, client: &BcForgeTokenClient) -> Address {
    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );
    admin
}

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let (client, _) = setup_contract(env);
    let admin = init_default(env, &client);
    (client, admin)
}

fn make_dummy_wasm_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

#[test]
fn test_mint_transfer_and_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint(&from, &1_000);
    client.transfer(&from, &to, &300);

    assert_eq!(client.balance(&from), 700);
    assert_eq!(client.balance(&to), 300);
    assert_eq!(client.supply(), 1_000);
}

#[test]
fn test_initialize_emits_correct_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Test Token");
    let symbol = String::from_str(&env, "TST");

    client.initialize(&admin, &7, &name, &symbol);

    let events = env.events().all();
    assert_eq!(
        events.len(),
        1,
        "expected exactly one event during initialization"
    );

    let (emitter, topics, data) = events.get(0).unwrap();

    assert_eq!(emitter, contract_id);

    assert_eq!(
        topics.len(),
        2,
        "topics should contain init symbol and admin"
    );

    let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(
        topic0,
        symbol_short!("init"),
        "first topic should be the 'init' symbol"
    );

    let topic1: soroban_sdk::Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic1, admin, "second topic should be the admin address");

    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    assert_eq!(
        data_vec.len(),
        3,
        "data should have 3 elements (decimal, name, symbol), confirming admin is in topics"
    );

    let decimal: u32 = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(decimal, 7);
}

// ─── Contract Upgrade Tests ──────────────────────────────────────────────────

#[test]
fn test_upgrade_direct_single_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let hash = make_dummy_wasm_hash(&env);

    assert_eq!(client.admin(), admin);
    client.upgrade(&hash);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_upgrade_before_init_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _contract_id) = setup_contract(&env);
    let hash = make_dummy_wasm_hash(&env);

    client.upgrade(&hash);
}

// ─── Multi-Sig Admin Pool Tests ──────────────────────────────────────────────

#[test]
fn test_set_admin_pool_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let member_a = Address::generate(&env);
    let member_b = Address::generate(&env);
    let pool = vec![&env, admin.clone(), member_a.clone(), member_b.clone()];

    client.set_admin_pool(&pool, &2);

    let stored_pool = client.get_admin_pool();
    assert_eq!(stored_pool.len(), 3);
    assert_eq!(stored_pool.get(0).unwrap(), admin);
    assert_eq!(stored_pool.get(1).unwrap(), member_a);
    assert_eq!(stored_pool.get(2).unwrap(), member_b);
    assert_eq!(client.get_threshold(), 2);
}

#[test]
fn test_set_admin_pool_default_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    assert_eq!(client.get_threshold(), 1);
}

#[test]
#[should_panic(expected = "invalid threshold for admin pool")]
fn test_set_admin_pool_zero_threshold_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin];

    client.set_admin_pool(&pool, &0);
}

#[test]
#[should_panic(expected = "invalid threshold for admin pool")]
fn test_set_admin_pool_threshold_exceeds_pool_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin];

    client.set_admin_pool(&pool, &3);
}

// ─── Propose Upgrade Tests ───────────────────────────────────────────────────

#[test]
fn test_propose_upgrade_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade to v2");

    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    assert_eq!(proposal_id, 0);
}

#[test]
#[should_panic(expected = "only admins can create proposals")]
fn test_propose_upgrade_non_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "malicious upgrade");
    let random = Address::generate(&env);

    client.propose_upgrade(&random, &desc, &hash);
}

// ─── Approve Upgrade Tests ───────────────────────────────────────────────────

#[test]
fn test_approve_upgrade_happy_path() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let member_b = Address::generate(&env);
    let pool = vec![&env, admin.clone(), member_b.clone()];

    client.set_admin_pool(&pool, &2);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade to v2");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    client.approve_upgrade(&member_b, &proposal_id);
}

#[test]
#[should_panic(expected = "only admins can approve proposals")]
fn test_approve_upgrade_non_pool_member_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let member_b = Address::generate(&env);
    let pool = vec![&env, admin.clone(), member_b.clone()];

    client.set_admin_pool(&pool, &2);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);
    let random = Address::generate(&env);

    client.approve_upgrade(&random, &proposal_id);
}

#[test]
#[should_panic(expected = "admin already approved this proposal")]
fn test_approve_upgrade_double_approval_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin.clone()];

    client.set_admin_pool(&pool, &1);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    client.approve_upgrade(&admin, &proposal_id);
}

// ─── Execute Upgrade Tests ───────────────────────────────────────────────────

#[test]
fn test_execute_upgrade_full_multi_sig_flow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);
    let pool = vec![&env, admin.clone(), member_b.clone(), member_c.clone()];

    client.set_admin_pool(&pool, &2);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade to v2");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    client.approve_upgrade(&member_b, &proposal_id);
    client.execute_upgrade(&proposal_id);
}

#[test]
fn test_execute_upgrade_single_admin_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin.clone()];

    client.set_admin_pool(&pool, &1);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    assert_eq!(proposal_id, 0);
    client.execute_upgrade(&proposal_id);
}

#[test]
#[should_panic(expected = "threshold not met")]
fn test_execute_upgrade_insufficient_approvals_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let member_b = Address::generate(&env);
    let pool = vec![&env, admin.clone(), member_b];

    client.set_admin_pool(&pool, &2);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    client.execute_upgrade(&proposal_id);
}

#[test]
#[should_panic(expected = "proposal already executed")]
fn test_execute_upgrade_double_execution_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin.clone()];

    client.set_admin_pool(&pool, &1);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    client.execute_upgrade(&proposal_id);
    client.execute_upgrade(&proposal_id);
}

#[test]
#[should_panic(expected = "proposal already executed")]
fn test_approve_after_execute_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin.clone()];

    client.set_admin_pool(&pool, &1);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "upgrade");
    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);

    client.execute_upgrade(&proposal_id);
    client.approve_upgrade(&admin, &proposal_id);
}

#[test]
#[should_panic(expected = "proposal not found")]
fn test_execute_upgrade_nonexistent_proposal_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    client.execute_upgrade(&999);
}

// ─── Multi-Sig Configuration Edge Cases ──────────────────────────────────────

#[test]
fn test_multiple_proposals_independent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin.clone()];

    client.set_admin_pool(&pool, &1);

    let hash_a = make_dummy_wasm_hash(&env);
    let hash_b = make_dummy_wasm_hash(&env);

    let id_a = client.propose_upgrade(&admin, &String::from_str(&env, "upgrade A"), &hash_a);
    let id_b = client.propose_upgrade(&admin, &String::from_str(&env, "upgrade B"), &hash_b);

    assert_eq!(id_a, 0);
    assert_eq!(id_b, 1);

    client.execute_upgrade(&id_b);
}

#[test]
fn test_admin_pool_can_include_multiple_members() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let mut pool_vec = vec![&env, admin.clone()];
    for _ in 0..5 {
        pool_vec.push_back(Address::generate(&env));
    }

    client.set_admin_pool(&pool_vec, &3);

    let stored_pool = client.get_admin_pool();
    assert_eq!(stored_pool.len(), 6);
    assert_eq!(client.get_threshold(), 3);
}

#[test]
fn test_direct_upgrade_after_multi_sig_setup() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let member_b = Address::generate(&env);
    let pool = vec![&env, admin.clone(), member_b];

    client.set_admin_pool(&pool, &2);

    assert_eq!(client.get_threshold(), 2);

    let hash = make_dummy_wasm_hash(&env);
    client.upgrade(&hash);
}

#[test]
fn test_upgrade_hash_stored_per_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let pool = vec![&env, admin.clone()];

    client.set_admin_pool(&pool, &1);

    let hash_a = make_dummy_wasm_hash(&env);
    let hash_b = make_dummy_wasm_hash(&env);

    let id_a = client.propose_upgrade(&admin, &String::from_str(&env, "a"), &hash_a);
    let id_b = client.propose_upgrade(&admin, &String::from_str(&env, "b"), &hash_b);

    assert_eq!(id_a, 0);
    assert_eq!(id_b, 1);

    client.execute_upgrade(&id_b);
}

// ─── Getter Tests ────────────────────────────────────────────────────────────

#[test]
fn test_get_admin_pool_before_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let pool = client.get_admin_pool();
    assert_eq!(pool.len(), 1);
    assert_eq!(pool.get(0).unwrap(), admin);
}

#[test]
fn test_get_threshold_before_set() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    assert_eq!(client.get_threshold(), 1);
}

// ─── Edge Cases ──────────────────────────────────────────────────────────────

#[test]
fn test_propose_approve_execute_different_admins() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let proposer = Address::generate(&env);
    let approver = Address::generate(&env);

    let pool = vec![&env, admin.clone(), proposer.clone(), approver.clone()];
    client.set_admin_pool(&pool, &2);

    let hash = make_dummy_wasm_hash(&env);
    let desc = String::from_str(&env, "multi-admin upgrade");

    let proposal_id = client.propose_upgrade(&admin, &desc, &hash);
    client.approve_upgrade(&approver, &proposal_id);
    client.execute_upgrade(&proposal_id);
}
