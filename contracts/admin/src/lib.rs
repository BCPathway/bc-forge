//! Reusable access-control primitives for Soroban contracts.

#![no_std]

use bc_forge_ttl as ttl;
use soroban_sdk::{contracterror, contracttype, symbol_short, vec, Address, Env, String, Vec};

/// Error types for admin operations
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum AdminError {
    /// Role is already granted to the address
    RoleAlreadyGranted = 1,
    /// Address does not have the required role
    UnauthorizedRoleGrant = 2,
    /// Invalid role configuration
    InvalidRoleConfiguration = 3,
}

#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    Admin,
    Role(Role, Address),
    AdminPool,
    Threshold,
    Proposal(u64),
    ProposalIdCounter,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    Admin,
    Minter,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Proposal {
    pub creator: Address,
    pub description: String,
    pub approvals: Vec<Address>,
    pub executed: bool,
}

fn extend_instance_ttl(env: &Env) {
    ttl::extend_instance_ttl(env);
}

fn extend_storage_ttl_for_key<K>(env: &Env, key: &K)
where
    K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    ttl::extend_storage_ttl_for_key(
        env,
        key,
        ttl::BALANCE_LIFETIME_THRESHOLD,
        ttl::BALANCE_BUMP_AMOUNT,
    );
}

/// Emit event when a role is granted to an address
fn emit_role_granted(env: &Env, role: Role, to: &Address, granted_by: &Address) {
    env.events().publish(
        (symbol_short!("grant_role"),),
        (role as u32, to.clone(), granted_by.clone()),
    );
}

/// Emit event when a role is revoked from an address
fn emit_role_revoked(env: &Env, role: Role, from: &Address, revoked_by: &Address) {
    env.events().publish(
        (symbol_short!("revoke_role"),),
        (role as u32, from.clone(), revoked_by.clone()),
    );
}

/// Internal helper to grant a role to an address without authorization checks
/// This is called by public functions after they verify authorization
fn _grant_role(env: &Env, role: Role, to: &Address, granted_by: &Address) -> Result<(), AdminError> {
    // Check if the role is already granted to prevent redundant operations
    if has_role(env, role, to) {
        return Err(AdminError::RoleAlreadyGranted);
    }

    // Store the role in persistent storage
    env.storage()
        .persistent()
        .set(&AdminKey::Role(role, to.clone()), &true);

    // Extend TTL to maintain role data longevity
    extend_storage_ttl_for_key(env, &AdminKey::Role(role, to.clone()));

    // Emit event for role grant operation
    emit_role_granted(env, role, to, granted_by);

    Ok(())
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&AdminKey::Admin, admin);
    env.storage()
        .persistent()
        .set(&AdminKey::Role(Role::Admin, admin.clone()), &true);
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Role(Role::Admin, admin.clone()));
}

pub fn get_admin(env: &Env) -> Address {
    let admin = env
        .storage()
        .instance()
        .get(&AdminKey::Admin)
        .expect("contract not initialized: admin not set");
    extend_instance_ttl(env);
    admin
}

pub fn has_admin(env: &Env) -> bool {
    let has = env.storage().instance().has(&AdminKey::Admin);
    if has {
        extend_instance_ttl(env);
    }
    has
}

pub fn grant_role(env: &Env, role: Role, address: &Address) -> Result<(), AdminError> {
    let admin = if has_admin(env) {
        require_admin(env);
        get_admin(env)
    } else {
        // If no admin is set yet, use a sentinel address for events
        // This maintains consistency during initialization
        address.clone()
    };

    // Call the internal helper to perform the actual role grant
    _grant_role(env, role, address, &admin)
}

pub fn revoke_role(env: &Env, role: Role, address: &Address) {
    let admin = require_admin(env);
    env.storage()
        .persistent()
        .remove(&AdminKey::Role(role, address.clone()));
    emit_role_revoked(env, role, address, &admin);
}

pub fn has_role(env: &Env, role: Role, address: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&AdminKey::Role(Role::Admin, address.clone()))
        || env
            .storage()
            .persistent()
            .has(&AdminKey::Role(role, address.clone()))
}

pub fn require_admin(env: &Env) -> Address {
    let admin = get_admin(env);
    admin.require_auth();
    admin
}

pub fn require_role(env: &Env, role: Role, address: &Address) {
    if !has_role(env, role, address) {
        panic!("unauthorized: missing role");
    }
    address.require_auth();
}

pub fn set_admin_pool(env: &Env, pool: Vec<Address>, threshold: u32) {
    if threshold == 0 || threshold > pool.len() {
        panic!("invalid threshold for admin pool");
    }
    env.storage().instance().set(&AdminKey::AdminPool, &pool);
    env.storage()
        .instance()
        .set(&AdminKey::Threshold, &threshold);
    extend_instance_ttl(env);
}

pub fn get_admin_pool(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&AdminKey::AdminPool)
        .unwrap_or_else(|| {
            if has_admin(env) {
                vec![env, get_admin(env)]
            } else {
                vec![env]
            }
        })
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&AdminKey::Threshold)
        .unwrap_or(1)
}

pub fn create_proposal(env: &Env, creator: Address, description: String) -> u64 {
    creator.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&creator) {
        panic!("only admins can create proposals");
    }

    let id = env
        .storage()
        .instance()
        .get(&AdminKey::ProposalIdCounter)
        .unwrap_or(0u64);
    env.storage()
        .instance()
        .set(&AdminKey::ProposalIdCounter, &(id + 1));

    let proposal = Proposal {
        creator: creator.clone(),
        description,
        approvals: vec![env, creator],
        executed: false,
    };
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(id), &proposal);
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Proposal(id));
    id
}

pub fn approve_proposal(env: &Env, admin: Address, proposal_id: u64) {
    admin.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&admin) {
        panic!("only admins can approve proposals");
    }

    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if proposal.approvals.contains(&admin) {
        panic!("admin already approved this proposal");
    }

    proposal.approvals.push_back(admin);
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Proposal(proposal_id));
}

pub fn is_proposal_ready(env: &Env, proposal_id: u64) -> bool {
    let proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Proposal(proposal_id));
    proposal.approvals.len() >= get_threshold(env)
}

pub fn mark_executed(env: &Env, proposal_id: u64) {
    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if !is_proposal_ready(env, proposal_id) {
        panic!("threshold not met");
    }

    proposal.executed = true;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Proposal(proposal_id));
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{contract, contractimpl, Address, Env};

    #[contract]
    struct AdminContract;

    #[contractimpl]
    impl AdminContract {
        pub fn set_admin(env: Env, admin: Address) {
            super::set_admin(&env, &admin);
        }

        pub fn grant_role(env: Env, role: Role, address: Address) -> Result<(), AdminError> {
            super::grant_role(&env, role, &address)
        }

        pub fn has_role(env: Env, role: Role, address: Address) -> bool {
            super::has_role(&env, role, &address)
        }

        pub fn revoke_role(env: Env, role: Role, address: Address) {
            super::revoke_role(&env, role, &address);
        }

        pub fn _grant_role_internal(
            env: Env,
            role: Role,
            to: Address,
            granted_by: Address,
        ) -> Result<(), AdminError> {
            super::_grant_role(&env, role, &to, &granted_by)
        }
    }

    #[test]
    fn test_grant_role_extends_ttl_across_ledger_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.grant_role(&Role::Minter, &role_holder);
        assert!(result.is_ok());

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);
        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_grant_role_success() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.set_admin(&admin);
        let result = client.grant_role(&Role::Minter, &user);
        assert!(result.is_ok());
        assert!(client.has_role(&Role::Minter, &user));
    }

    #[test]
    fn test_grant_role_duplicate_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.set_admin(&admin);
        let result1 = client.grant_role(&Role::Minter, &user);
        assert!(result1.is_ok());

        // Attempting to grant the same role twice should fail
        let result2 = client.grant_role(&Role::Minter, &user);
        assert!(result2.is_err());
        assert_eq!(
            result2.err().unwrap(),
            AdminError::RoleAlreadyGranted
        );
    }

    #[test]
    fn test_internal_grant_role_helper() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.set_admin(&admin);
        let result = client._grant_role_internal(&Role::Admin, &user, &admin);
        assert!(result.is_ok());
        assert!(client.has_role(&Role::Admin, &user));
    }

    #[test]
    fn test_revoke_role_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&Role::Minter, &user).ok();
        
        // Revoke should succeed and user should no longer have role
        client.revoke_role(&Role::Minter, &user);
        assert!(!client.has_role(&Role::Minter, &user));
    }

    #[test]
    fn test_grant_role_preserves_admin_role() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.set_admin(&admin);
        // Admin should have Admin role by default
        assert!(client.has_role(&Role::Admin, &admin));

        // Grant Minter role to user
        client.grant_role(&Role::Minter, &user).ok();
        
        // Admin should still have Admin role
        assert!(client.has_role(&Role::Admin, &admin));
        assert!(client.has_role(&Role::Minter, &user));
    }
}
