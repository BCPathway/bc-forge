#![cfg(test)]

use bc_forge_admin::{AdminError, Role, TIMELOCK_DELAY_SECS};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{contract, contractimpl, vec, Address, BytesN, Env, String};

#[allow(dead_code)]
fn upload_upgrade_wasm(env: &Env) -> BytesN<32> {
    let wasm = include_bytes!("../testdata/contract.wasm");
    env.deployer().upload_contract_wasm(wasm.as_slice())
}

#[contract]
pub struct AdminContract;

#[contractimpl]
impl AdminContract {
    pub fn set_admin(env: Env, admin: Address) {
        bc_forge_admin::set_admin(&env, &admin);
    }

    pub fn init_storage(env: Env, admin: Address) -> Result<(), AdminError> {
        bc_forge_admin::init_storage(&env, &admin)
    }

    pub fn grant_role(env: Env, caller: Address, role: Role, address: Address) {
        bc_forge_admin::grant_role(&env, &caller, role, &address);
    }

    pub fn revoke_role(
        env: Env,
        caller: Address,
        role: Role,
        address: Address,
    ) -> Result<(), AdminError> {
        bc_forge_admin::revoke_role(&env, &caller, role, &address)
    }

    pub fn has_role(env: Env, role: Role, address: Address) -> bool {
        bc_forge_admin::has_role(&env, role, &address)
    }

    pub fn get_role_admin(env: Env, role: Role) -> Address {
        bc_forge_admin::get_role_admin(&env, role)
    }

    pub fn require_admin(env: Env, address: Address) {
        bc_forge_admin::require_admin(&env, &address);
    }

    pub fn require_minter(env: Env, address: Address) {
        bc_forge_admin::require_minter(&env, &address);
    }

    pub fn require_pauser(env: Env, address: Address) {
        bc_forge_admin::require_pauser(&env, &address);
    }

    pub fn require_super_admin(env: Env, address: Address) {
        bc_forge_admin::require_super_admin(&env, &address);
    }

    pub fn set_admin_pool(env: Env, pool: soroban_sdk::Vec<Address>, threshold: u32) {
        bc_forge_admin::set_admin_pool(&env, pool, threshold);
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

    pub fn execute_upgrade(
        env: Env,
        executor: Address,
        proposal_id: u64,
        wasm_hash: BytesN<32>,
    ) -> Result<(), AdminError> {
        bc_forge_admin::execute_upgrade(&env, executor, proposal_id, wasm_hash)
    }

    pub fn emergency_execute_upgrade(
        env: Env,
        executor: Address,
        proposal_id: u64,
        wasm_hash: BytesN<32>,
    ) -> Result<(), AdminError> {
        bc_forge_admin::emergency_execute_upgrade(&env, executor, proposal_id, wasm_hash)
    }

    pub fn cancel_proposal(env: Env, caller: Address, proposal_id: u64) -> Result<(), AdminError> {
        bc_forge_admin::cancel_proposal(&env, caller, proposal_id)
    }

    pub fn migrate_admin(env: Env) {
        bc_forge_admin::migrate_admin(&env);
    }

    pub fn has_admin(env: Env) -> bool {
        bc_forge_admin::has_admin(&env)
    }
}

/// End-to-end integration test flow for V1 to V2 admin contract upgrade and RBAC migration.
#[test]
fn test_e2e_v1_to_v2_admin_upgrade_and_rbac_lifecycle() {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Deploy V1 admin contract and initialize under V1 (non-RBAC) admin model
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    client.set_admin(&admin);

    // 2. Perform V1 pre-upgrade baseline assertions
    assert!(client.has_admin());
    assert_eq!(client.get_role_admin(&Role::Admin), admin);

    // Non-admin user attempting role-gated action must fail under pre-upgrade model
    let unauth_res = client.try_grant_role(&user_a, &Role::Minter, &user_b);
    assert!(unauth_res.is_err());

    // 3. Perform contract upgrade storage migration (copying AdminKey::Admin -> AdminKey::SuperAdmin)
    client.migrate_admin();

    // 4. Verify post-upgrade role persistence under new RBAC model
    assert!(client.has_role(&Role::SuperAdmin, &admin));
    assert!(client.has_role(&Role::Admin, &admin));

    // 5. Verify post-upgrade RBAC enforcement and role-gated actions
    // Admin (holding SuperAdmin/Admin) grants Minter role to user_a and Pauser role to user_b
    client.grant_role(&admin, &Role::Minter, &user_a);
    client.grant_role(&admin, &Role::Pauser, &user_b);

    assert!(client.has_role(&Role::Minter, &user_a));
    assert!(client.has_role(&Role::Pauser, &user_b));
    assert!(!client.has_role(&Role::Minter, &user_b));
    assert!(!client.has_role(&Role::Pauser, &user_a));

    // Assert role-gated checks succeed for authorized accounts
    client.require_minter(&user_a);
    client.require_pauser(&user_b);

    // Assert unauthorized user cannot grant roles post-upgrade
    let post_upgrade_unauth = client.try_grant_role(&user_a, &Role::Pauser, &user_a);
    assert!(post_upgrade_unauth.is_err());
}

/// Negative case: upgrading with an unauthorized caller must fail.
#[test]
fn test_unauthorized_caller_cannot_execute_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let unauthorized_executor = Address::generate(&env);

    client.set_admin(&admin);
    client.set_admin_pool(&vec![&env, admin.clone()], &1);

    // Create proposal to execute upgrade (creator is auto-recorded as first approval)
    let proposal_id = client.create_proposal(&admin, &String::from_str(&env, "Upgrade"));

    // Advance ledger timestamp past mandatory timelock delay
    let mut ledger_info = env.ledger().get();
    ledger_info.timestamp += TIMELOCK_DELAY_SECS + 1;
    env.ledger().set(ledger_info);

    let dummy_wasm_hash = BytesN::from_array(&env, &[1u8; 32]);

    // Unauthorized caller attempting to execute upgrade proposal must fail
    let res = client.try_execute_upgrade(&unauthorized_executor, &proposal_id, &dummy_wasm_hash);
    assert!(res.is_err());
}

/// Edge case: migrate_admin is idempotent and safe to call multiple times.
#[test]
fn test_migrate_admin_idempotency() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    client.set_admin(&admin);

    // Call migrate_admin multiple times sequentially
    client.migrate_admin();
    client.migrate_admin();
    client.migrate_admin();

    // Verify SuperAdmin status remains valid and uncorrupted
    assert!(client.has_role(&Role::SuperAdmin, &admin));
}

/// Boundary case: verify no stale permissions allow ungranted roles post-upgrade.
#[test]
fn test_unauthorized_user_cannot_grant_roles_post_upgrade() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);

    client.set_admin(&admin);
    client.migrate_admin();

    // user_a has no roles assigned and must not be able to grant roles to user_b
    let res = client.try_grant_role(&user_a, &Role::Minter, &user_b);
    assert!(res.is_err());
    assert!(!client.has_role(&Role::Minter, &user_b));
}

/// Unit test preventing duplicate votes (double vote reverts with ProposalAlreadyApproved / AlreadyVoted error).
#[test]
fn test_double_vote_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let member = Address::generate(&env);

    client.set_admin(&admin);
    client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);

    let proposal_id =
        client.create_proposal(&admin, &String::from_str(&env, "WASM upgrade proposal"));

    // 1. Signer approves (first vote)
    client.approve_proposal(&member, &proposal_id);
    assert!(client.is_proposal_ready(&proposal_id));

    // 2. Signer approves again (double vote attempt)
    let res = client.try_approve_proposal(&member, &proposal_id);

    // 3. Assert ProposalAlreadyApproved error (AlreadyVoted error code 10)
    assert_eq!(
        res,
        Err(Ok(soroban_sdk::Error::from_contract_error(
            AdminError::ProposalAlreadyApproved as u32
        )))
    );
}
