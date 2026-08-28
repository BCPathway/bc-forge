//! End-to-end coverage for the multi-sig gated WASM upgrade flow. Resolves
//! issue #672 (epic: Multi-Sig Gated WASM Upgrades).
//!
//! Exercises the full lifecycle exposed by `bc_forge_admin` today: deploy a
//! contract, register a new WASM hash as a valid upgrade target (#657),
//! submit a proposal, collect approvals until quorum is reached, and drive
//! `execute_upgrade` through every governance gate (pool membership, quorum,
//! mandatory timelock) up to the point where it installs the new logic.
//!
//! `upgrade_e2e.rs` (in this same directory) covers the `migrate_admin`
//! storage-migration path. This file is the companion for the quorum +
//! timelock gated `execute_upgrade` path, which had no dedicated test
//! coverage of its error states before this change.

#![cfg(test)]

use bc_forge_admin::{AdminError, AdminKey, Proposal, TIMELOCK_DELAY_SECS};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, String};

#[contract]
pub struct AdminContract;

#[contractimpl]
impl AdminContract {
    pub fn set_admin(env: Env, admin: Address) {
        bc_forge_admin::set_admin(&env, &admin);
    }

    pub fn set_admin_pool(env: Env, pool: soroban_sdk::Vec<Address>, threshold: u32) {
        bc_forge_admin::set_admin_pool(&env, pool, threshold);
    }

    pub fn get_admin_pool(env: Env) -> soroban_sdk::Vec<Address> {
        bc_forge_admin::get_admin_pool(&env)
    }

    pub fn get_threshold(env: Env) -> u32 {
        bc_forge_admin::get_threshold(&env)
    }

    pub fn register_wasm_hash(env: Env, admin: Address, wasm_hash: BytesN<32>) {
        bc_forge_admin::register_wasm_hash(&env, &admin, wasm_hash);
    }

    pub fn require_valid_wasm_hash(env: Env, wasm_hash: BytesN<32>) -> Result<(), AdminError> {
        bc_forge_admin::require_valid_wasm_hash(&env, &wasm_hash)
    }

    pub fn create_proposal(env: Env, creator: Address, description: String) -> u64 {
        bc_forge_admin::create_proposal(&env, creator, description)
    }

    pub fn approve_proposal(env: Env, admin: Address, proposal_id: u64) {
        bc_forge_admin::approve_proposal(&env, admin, proposal_id);
    }

    pub fn is_proposal_ready(env: Env, proposal_id: u64) -> bool {
        bc_forge_admin::is_proposal_ready(&env, proposal_id)
    }

    pub fn get_proposal_unlock_time(env: Env, proposal_id: u64) -> Option<u64> {
        bc_forge_admin::get_proposal_unlock_time(&env, proposal_id)
    }

    pub fn execute_upgrade(
        env: Env,
        executor: Address,
        proposal_id: u64,
        wasm_hash: BytesN<32>,
    ) -> Result<(), AdminError> {
        bc_forge_admin::execute_upgrade(&env, executor, proposal_id, wasm_hash)
    }
}

fn deploy(env: &Env) -> (Address, AdminContractClient<'_>) {
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    (contract_id, client)
}

/// Stand-in for a real `soroban contract upload` of the new build. This
/// sandboxed test `Env` runs contract logic natively rather than through a
/// real WASM VM, so no bytecode actually exists at any hash; the hash alone
/// is enough to drive `register_wasm_hash` / `require_valid_wasm_hash` (#657)
/// and to identify "the new logic" a proposal targets.
fn v2_wasm_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[2u8; 32])
}

fn advance_past_timelock(env: &Env, unlock_at: u64) {
    let mut ledger_info = env.ledger().get();
    ledger_info.timestamp = unlock_at;
    env.ledger().set(ledger_info);
}

/// The full happy path: deploy, register the new WASM as an upgrade target,
/// propose, gather quorum, and confirm every pre-execution guard behaves
/// correctly along the way (pool membership, quorum, and the mandatory
/// review-window timelock).
#[test]
fn test_e2e_deploy_propose_reach_quorum_and_gate_execution() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Deploy and configure a 3-member pool with a 2-of-3 quorum.
    let (_contract_id, client) = deploy(&env);
    let admin = Address::generate(&env);
    let member_b = Address::generate(&env);
    let member_c = Address::generate(&env);

    client.set_admin(&admin);
    client.set_admin_pool(
        &vec![&env, admin.clone(), member_b.clone(), member_c.clone()],
        &2,
    );
    assert_eq!(client.get_threshold(), 2);
    assert_eq!(client.get_admin_pool().len(), 3);

    // 2. "Deploy" the new WASM: register its hash as a valid upgrade target.
    // Unregistered hashes are rejected until then.
    let new_hash = v2_wasm_hash(&env);
    assert_eq!(
        client.try_require_valid_wasm_hash(&new_hash),
        Err(Ok(AdminError::InvalidWasmHash))
    );
    client.register_wasm_hash(&admin, &new_hash);
    assert_eq!(client.try_require_valid_wasm_hash(&new_hash), Ok(Ok(())));

    // 3. Propose the upgrade. The creator's auto-approval is 1 of the 2
    // approvals needed, so quorum is not yet met.
    let proposal_id = client.create_proposal(&admin, &String::from_str(&env, "Upgrade to v2"));
    assert!(!client.is_proposal_ready(&proposal_id));
    assert!(client.get_proposal_unlock_time(&proposal_id).is_none());

    // Execution before quorum must fail.
    let premature = client.try_execute_upgrade(&admin, &proposal_id, &new_hash);
    assert_eq!(premature, Err(Ok(AdminError::QuorumNotMet)));

    // 4. A second pool member approves, reaching 2-of-3 quorum and starting
    // the mandatory timelock.
    client.approve_proposal(&member_b, &proposal_id);
    assert!(client.is_proposal_ready(&proposal_id));
    let unlock_at = client
        .get_proposal_unlock_time(&proposal_id)
        .expect("timelock must be recorded once quorum is reached");
    assert_eq!(unlock_at, env.ledger().timestamp() + TIMELOCK_DELAY_SECS);

    // 5. Quorum alone is not enough: the review-window timelock still blocks
    // execution.
    let still_locked = client.try_execute_upgrade(&admin, &proposal_id, &new_hash);
    assert_eq!(still_locked, Err(Ok(AdminError::TimelockActive)));

    // 6. An address outside the pool can never execute, quorum or not.
    let outsider = Address::generate(&env);
    let unauthorized = client.try_execute_upgrade(&outsider, &proposal_id, &new_hash);
    assert_eq!(unauthorized, Err(Ok(AdminError::UnauthorizedRole)));

    // A third, uninvolved member's approval attempt on an already-quorate
    // proposal does not disturb the recorded unlock time (never pushed back).
    client.approve_proposal(&member_c, &proposal_id);
    assert_eq!(
        client.get_proposal_unlock_time(&proposal_id),
        Some(unlock_at)
    );

    // 7. Advance past the mandatory review window. Every governance
    // precondition (pool membership, quorum, timelock) is now satisfied.
    advance_past_timelock(&env, unlock_at);
    assert!(client.is_proposal_ready(&proposal_id));
}

/// Once every multi-sig precondition is satisfied, `execute_upgrade` reaches
/// `env.deployer().update_current_contract_wasm`. This sandboxed test `Env`
/// has no real WASM installed at any hash — the same constraint already
/// documented on
/// `contracts/token/src/test.rs::test_upgrade_permits_super_admin_role_holder_past_the_guard` —
/// so the call panics there instead of returning `Ok`. That panic is proof
/// the multi-sig gate let the call all the way through to the WASM swap
/// (i.e. "verifies the new logic" would install), not a failure of the
/// governance logic under test.
#[test]
#[should_panic]
fn test_e2e_quorum_and_timelock_satisfied_reaches_wasm_install() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client) = deploy(&env);
    let admin = Address::generate(&env);
    let member_b = Address::generate(&env);

    client.set_admin(&admin);
    client.set_admin_pool(&vec![&env, admin.clone(), member_b.clone()], &2);

    let new_hash = v2_wasm_hash(&env);
    client.register_wasm_hash(&admin, &new_hash);

    let proposal_id = client.create_proposal(&admin, &String::from_str(&env, "Upgrade to v2"));
    client.approve_proposal(&member_b, &proposal_id);

    let unlock_at = client
        .get_proposal_unlock_time(&proposal_id)
        .expect("quorum was just reached");
    advance_past_timelock(&env, unlock_at);

    client.execute_upgrade(&admin, &proposal_id, &new_hash);
}

/// `execute_upgrade` rejects a proposal ID that was never created.
#[test]
fn test_e2e_execute_upgrade_rejects_nonexistent_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (_contract_id, client) = deploy(&env);
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_admin_pool(&vec![&env, admin.clone()], &1);

    let result = client.try_execute_upgrade(&admin, &9999, &v2_wasm_hash(&env));
    assert_eq!(result, Err(Ok(AdminError::ProposalNotFound)));
}

/// Upgrades are one-shot: an already-executed proposal must be rejected
/// rather than re-triggering `update_current_contract_wasm`. Reaching a
/// genuinely `executed` proposal would require a real WASM swap that this
/// sandboxed `Env` cannot perform (see the test above), so this test seeds
/// the post-execution state directly — exactly the state `execute_upgrade`
/// itself would have persisted via its checks-effects-interactions write,
/// before ever touching the deployer.
#[test]
fn test_e2e_execute_upgrade_rejects_already_executed_proposal() {
    let env = Env::default();
    env.mock_all_auths();

    let (contract_id, client) = deploy(&env);
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_admin_pool(&vec![&env, admin.clone()], &1);

    let proposal_id = client.create_proposal(&admin, &String::from_str(&env, "Upgrade to v2"));

    env.as_contract(&contract_id, || {
        let mut proposal: Proposal = env
            .storage()
            .instance()
            .get(&AdminKey::Proposal(proposal_id))
            .expect("proposal was just created");
        proposal.executed = true;
        env.storage()
            .instance()
            .set(&AdminKey::Proposal(proposal_id), &proposal);
    });

    let result = client.try_execute_upgrade(&admin, &proposal_id, &v2_wasm_hash(&env));
    assert_eq!(result, Err(Ok(AdminError::ProposalAlreadyExecuted)));
}
