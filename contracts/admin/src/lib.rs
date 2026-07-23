//! Reusable access-control primitives for Soroban contracts.

#![no_std]

use bc_forge_ttl as ttl;
use soroban_sdk::{contracttype, vec, Address, Env, String, Vec};

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

pub fn grant_role(env: &Env, role: Role, address: &Address) {
    if has_admin(env) {
        require_admin(env);
    }
    env.storage()
        .persistent()
        .set(&AdminKey::Role(role, address.clone()), &true);
    extend_storage_ttl_for_key(env, &AdminKey::Role(role, address.clone()));
}

pub fn revoke_role(env: &Env, role: Role, address: &Address) {
    require_admin(env);
    env.storage()
        .persistent()
        .remove(&AdminKey::Role(role, address.clone()));
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

pub fn require_admin(env: &Env) {
    get_admin(env).require_auth();
}

/// Convert a `u32` to a [`Role`], returning [`None`] if the value is out of
/// bounds (i.e. not a valid discriminant).
///
/// This is the primary bounds‑checking entry point for roles received as raw
/// integers (e.g. from proposal parameters or cross‑contract calls).
pub fn role_from_u32(value: u32) -> Option<Role> {
    match value {
        0 => Some(Role::Admin),
        1 => Some(Role::Minter),
        _ => None,
    }
}

/// Convert a `u32` to a [`Role`], panicking if the value is out of bounds.
///
/// # Panics
/// - If `value` is not a valid [`Role`] discriminant.
pub fn ensure_role_bounds(value: u32) -> Role {
    role_from_u32(value).expect("role value out of bounds")
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

        pub fn grant_role(env: Env, role: Role, address: Address) {
            super::grant_role(&env, role, &address);
        }

        pub fn has_role(env: Env, role: Role, address: Address) -> bool {
            super::has_role(&env, role, &address)
        }
    }

    #[test]
    fn test_role_from_u32_valid() {
        assert_eq!(role_from_u32(0), Some(Role::Admin));
        assert_eq!(role_from_u32(1), Some(Role::Minter));
    }

    #[test]
    fn test_role_from_u32_out_of_bounds() {
        assert_eq!(role_from_u32(2), None);
        assert_eq!(role_from_u32(u32::MAX), None);
    }

    #[test]
    fn test_ensure_role_bounds_valid() {
        assert_eq!(ensure_role_bounds(0), Role::Admin);
        assert_eq!(ensure_role_bounds(1), Role::Minter);
    }

    #[test]
    #[should_panic(expected = "role value out of bounds")]
    fn test_ensure_role_bounds_panics_on_invalid() {
        ensure_role_bounds(99);
    }

    #[test]
    fn test_role_bounds_storage_compatibility() {
        // Verify that a role obtained via ensure_role_bounds works identically
        // to the enum variant when used with storage operations.
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.set_admin(&admin);

        let minter = ensure_role_bounds(1);
        client.grant_role(&minter, &holder);
        assert!(client.has_role(&Role::Minter, &holder));
        assert!(client.has_role(&minter, &holder));
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
        client.grant_role(&Role::Minter, &role_holder);

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);
        assert!(client.has_role(&Role::Minter, &role_holder));
    }
}
