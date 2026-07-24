use crate::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::{symbol_short, Address, BytesN, Env, String, TryIntoVal, Val};

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

    // Event must be emitted by the token contract itself
    assert_eq!(emitter, contract_id);

    // Topics must contain (symbol_short!("init"), admin_address)
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

    // Data must be (decimal, name, symbol) as Vec<Val>
    // If admin were incorrectly in data, this would have 4 elements
    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    assert_eq!(
        data_vec.len(),
        3,
        "data should have 3 elements (decimal, name, symbol), confirming admin is in topics"
    );

    // Verify the decimal value matches
    let decimal: u32 = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(decimal, 7);
}

#[test]
#[should_panic(expected = "unauthorized: missing role")]
fn test_upgrade_guard_rejects_caller_without_super_admin_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let contract_id = client.address.clone();
    let stranger = Address::generate(&env);

    // Exercises the exact guard call `upgrade` uses, directly and within
    // the contract's own storage context, so the raw panic message from
    // `require_role` is observed as-is rather than through the client's
    // Result-to-panic conversion (which reports a generic error code
    // instead of the original string).
    env.as_contract(&contract_id, || {
        bc_forge_admin::require_role(&env, bc_forge_admin::Role::SuperAdmin, &stranger);
    });
}

#[test]
#[should_panic]
fn test_upgrade_permits_super_admin_role_holder_past_the_guard() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let contract_id = client.address.clone();
    let upgrader = Address::generate(&env);
    let new_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);

    env.as_contract(&contract_id, || {
        bc_forge_admin::grant_role(&env, bc_forge_admin::Role::SuperAdmin, &upgrader);
    });

    // The guard passes for a SuperAdmin holder, so execution reaches
    // `update_current_contract_wasm`, which panics because there is no
    // installed contract at an all-zero wasm hash. That panic proves the
    // guard let the call through instead of blocking it.
    client.upgrade(&upgrader, &new_wasm_hash);
}
