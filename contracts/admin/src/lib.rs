//! Reusable access-control primitives for Soroban contracts.

#![no_std]

mod events;

use bc_forge_ttl as ttl;
use soroban_sdk::{contracterror, contracttype, vec, Address, Env, String, Vec};

/// Errors returned by the admin access-control module.
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum AdminError {
    /// `revoke_role` was called for an (role, address) pair that was never granted.
    RoleNotGranted = 1,
}

// IMPORTANT (storage migration):
// `#[contracttype]` enums are serialized into XDR union tags. Adding a new
// variant to `AdminKey` or `Role` is NOT forward-compatible with already-
// deployed contract instances — existing on-chain storage will deserialize
// the new discriminator under the legacy layout and fail. The `SuperAdmin`
// variants below intentionally live in the same module as a fresh-foundation
// component: deployments that need to retain compatibility should add a new
// companion contract (or wipe-and-redeploy) instead of in-place upgrading
// this crate.
#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    Admin,
    SuperAdmin,
    Role(Role, Address),
    AdminPool,
    Threshold,
    Proposal(u64),
    ProposalIdCounter,
}

/// Role hierarchy.
///
/// Variants are ordered from highest to lowest privilege. `SuperAdmin` is
/// the root authority — it implicitly satisfies every role check
/// (`has_role`, `require_role`). `Admin` supervises role minting and
/// proposal flow. Specific roles such as `Minter` are leaf capabilities.
///
/// Storage slots for roles never overlap: every
/// `AdminKey::Role(Role, Address)` pair is serialized via XDR union tags
/// into a deterministic, distinct ledger key.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    SuperAdmin,
/// Roles recognized by the access-control layer.
///
/// New variants must be appended, never inserted, so that previously
/// persisted `AdminKey::Role(Role, Address)` entries keep decoding to the
/// same variant they were written with.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Full administrative control granted via `set_admin`.
    Admin,
    /// Permission to mint new tokens.
    Minter,
    /// Highest-privilege role, reserved for owner-level operations.
    SuperAdmin,
}

/// Top-level alias for the SuperAdmin role constant, so downstream
/// contracts can `use bc_forge_admin::SUPER_ADMIN;` without importing
/// the enum path.
pub const SUPER_ADMIN: Role = Role::SuperAdmin;
pub const ADMIN: Role = Role::Admin;
pub const MINTER: Role = Role::Minter;

// Sentinel used to detect obviously-invalid addresses during admin/role
// assignment. Soroban addresses are stored as either `Account` (ed25519 key)
// or `Contract` (32-byte contract ID). Constructing a `Contract` address
// from all-zero bytes gives a deterministic, well-known sentinel that can be
// safely rejected in storage writes without relying on opaque internal
// representation.
//
// Built as a runtime helper rather than a `const` because the address
// constructor is not marked `const fn` on all SDK versions.
pub fn zero_address() -> Address {
    Address::from_contract_id(&[0u8; 32])
}

pub fn is_zero_address(address: &Address) -> bool {
    address == &zero_address()
}

fn require_valid_address(address: &Address) {
    if is_zero_address(address) {
        panic!("invalid zero address");
    }
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
    require_valid_address(admin);
    env.storage().instance().set(&AdminKey::Admin, admin);
    env.storage()
        .persistent()
        .set(&AdminKey::Role(Role::Admin, admin.clone()), &true);
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(env, &AdminKey::Role(Role::Admin, admin.clone()));
}

pub fn set_super_admin(env: &Env, super_admin: &Address) {
    require_valid_address(super_admin);
    // Re-promotion gate: once a SuperAdmin exists, only that SuperAdmin
    // may install a new root. The bootstrap case (no SuperAdmin yet) keeps
    // the legacy allow-anyone path so contracts can be initialised in
    // their constructor without an authority present.
    if has_super_admin(env) {
        require_super_admin(env);
    }
    env.storage()
        .instance()
        .set(&AdminKey::SuperAdmin, super_admin);
    env.storage().persistent().set(
        &AdminKey::Role(Role::SuperAdmin, super_admin.clone()),
        &true,
    );
    extend_instance_ttl(env);
    extend_storage_ttl_for_key(
        env,
        &AdminKey::Role(Role::SuperAdmin, super_admin.clone()),
    );
}

pub fn get_super_admin(env: &Env) -> Address {
    let super_admin = env
        .storage()
        .instance()
        .get(&AdminKey::SuperAdmin)
        .expect("contract not initialized: super admin not set");
    extend_instance_ttl(env);
    super_admin
}

pub fn has_super_admin(env: &Env) -> bool {
    let has = env.storage().instance().has(&AdminKey::SuperAdmin);
    if has {
        extend_instance_ttl(env);
    }
    has
}

pub fn require_super_admin(env: &Env) {
    get_super_admin(env).require_auth();
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
    require_valid_address(address);
    // NOTE: when neither SuperAdmin nor Admin is configured, anyone can
    // grant. This preserves the legacy "unset bootstrap" behaviour for
    // contracts that wire their constructor before installing any
    // authority. Treat this as a one-time initialisation window — as
    // soon as SuperAdmin/Admin is set, the auth gates above apply.
    if has_super_admin(env) {
        require_super_admin(env);
    } else if has_admin(env) {
        require_admin(env);
    }
    env.storage()
        .persistent()
        .set(&AdminKey::Role(role, address.clone()), &true);
    extend_storage_ttl_for_key(env, &AdminKey::Role(role, address.clone()));
}

pub fn revoke_role(env: &Env, role: Role, address: &Address) {
    // Mirror the grant_role precedence: SuperAdmin takes priority over
    // Admin, and an unset bootstrap leaves the call open. See NOTE on
    // `grant_role` above for the bootstrap caveat.
    if has_super_admin(env) {
        require_super_admin(env);
    } else if has_admin(env) {
        require_admin(env);
    }
    env.storage()
        .persistent()
        .remove(&AdminKey::Role(role, address.clone()));
pub fn revoke_role(env: &Env, role: Role, address: &Address) -> Result<(), AdminError> {
    let admin = get_admin(env);
    admin.require_auth();

    let key = AdminKey::Role(role, address.clone());
    if !env.storage().persistent().has(&key) {
        return Err(AdminError::RoleNotGranted);
    }

    env.storage().persistent().remove(&key);
    events::emit_role_revoked(env, &admin, role, address);
    Ok(())
}

pub fn has_role(env: &Env, role: Role, address: &Address) -> bool {
    let storage = env.storage().persistent();
    storage.has(&AdminKey::Role(Role::SuperAdmin, address.clone()))
        || storage.has(&AdminKey::Role(Role::Admin, address.clone()))
        || storage.has(&AdminKey::Role(role, address.clone()))
}

pub fn require_admin(env: &Env) {
    get_admin(env).require_auth();
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

        pub fn set_super_admin(env: Env, super_admin: Address) {
            super::set_super_admin(&env, &super_admin);
        pub fn revoke_role(env: Env, role: Role, address: Address) -> Result<(), AdminError> {
            super::revoke_role(&env, role, &address)
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
        client.grant_role(&Role::Minter, &role_holder);

        let mut ledger_info = env.ledger().get();
        ledger_info.sequence_number += 200;
        env.ledger().set(ledger_info);
        assert!(client.has_role(&Role::Minter, &role_holder));
    }

    #[test]
    fn test_zero_address_is_detected() {
        let env = Env::default();
        let zero = zero_address();
        assert!(is_zero_address(&zero));
        assert!(!is_zero_address(&Address::generate(&env)));
    }

    #[test]
    #[should_panic(expected = "invalid zero address")]
    fn test_set_admin_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        client.set_admin(&zero_address());
    }

    #[test]
    #[should_panic(expected = "invalid zero address")]
    fn test_set_super_admin_rejects_zero_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        client.set_super_admin(&zero_address());
    }

    #[test]
    #[should_panic(expected = "invalid zero address")]
    fn test_grant_role_rejects_zero_address() {
    fn test_super_admin_role_storage_does_not_overlap_with_other_roles() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.set_admin(&admin);
        client.grant_role(&Role::Minter, &zero_address());
    }

    #[test]
    fn test_role_constant_aliases_resolve_to_enum_variants() {
        assert_eq!(SUPER_ADMIN, Role::SuperAdmin);
        assert_eq!(ADMIN, Role::Admin);
        assert_eq!(MINTER, Role::Minter);
    }

    #[test]
    fn test_super_admin_role_constant_satisfies_all_role_checks() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let super_admin = Address::generate(&env);

        // Set up a regular admin so we can verify SuperAdmin's authority
        // overrides the existing access-control flow.
        let admin = Address::generate(&env);
        client.set_admin(&admin);

        // SuperAdmin implicitly satisfies Admin + Minter role checks even
        // though no explicit Admin/Minter role was granted.
        client.set_super_admin(&super_admin);
        assert!(client.has_role(&SUPER_ADMIN, &super_admin));
        assert!(client.has_role(&ADMIN, &super_admin));
        assert!(client.has_role(&MINTER, &super_admin));

        // SuperAdmin auth also unlocks `grant_role`, which exercises the
        // explicit auth precedence in the grant path (not just has_role).
        let new_minter = Address::generate(&env);
        client.grant_role(&Role::Minter, &new_minter);
        assert!(client.has_role(&Role::Minter, &new_minter));
    }

    #[test]
    fn test_storage_slots_are_separated_for_each_role_variant() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let holder = Address::generate(&env);

        // Grant Admin and Minter roles to the same holder. The two
        // AdminKey::Role(Role, Address) keys must resolve independently —
        // there should be no carry-over role leakage.
        client.set_admin(&holder);
        assert!(client.has_role(&Role::Admin, &holder));
        assert!(!client.has_role(&Role::Minter, &holder));

        client.grant_role(&Role::Minter, &holder);
        assert!(client.has_role(&Role::Minter, &holder));

        // SuperAdmin keyspace is independent — granting Admin / Minter does
        // not leak into the SuperAdmin slot.
        assert!(!client.has_role(&Role::SuperAdmin, &holder));
    }

    #[test]
    fn test_revoke_role_respects_super_admin_precedence() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let minter = Address::generate(&env);
        let super_admin = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&Role::Minter, &minter);
        assert!(client.has_role(&Role::Minter, &minter));

        // Once a SuperAdmin is installed, SuperAdmin auth must be enough
        // to revoke roles. We can't directly call revoke_role through the
        // test client (no method exposed), so we verify the precedence
        // path through grant_role + revoke via internal API.
        client.set_super_admin(&super_admin);
        assert!(client.has_role(&Role::SuperAdmin, &super_admin));

        super::revoke_role(&env, &Role::Minter, &minter);
        assert!(!client.has_role(&Role::Minter, &minter));
        let super_admin_holder = Address::generate(&env);
        let minter_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&Role::SuperAdmin, &super_admin_holder);
        client.grant_role(&Role::Minter, &minter_holder);

        assert!(client.has_role(&Role::SuperAdmin, &super_admin_holder));
        assert!(!client.has_role(&Role::Minter, &super_admin_holder));
        assert!(!client.has_role(&Role::SuperAdmin, &minter_holder));
        assert!(client.has_role(&Role::Minter, &minter_holder));
    }
}
