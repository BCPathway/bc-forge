//! Reusable access-control primitives for Soroban contracts.

#![no_std]

use soroban_sdk::{contracttype, Address, Env, String, Vec, vec};
use soroban_sdk::{contracttype, vec, Address, Env, String, Vec};

#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    /// The contract administrator address (singular, legacy primary admin).
    Admin,
    Role(Role, Address),
    /// Multi-sig required for specific critical actions: CriticalAction -> bool
    MultiSigRequired(CriticalAction),
    /// The pool of administrator addresses for multi-sig.
    AdminPool,
    Threshold,
    Proposal(u64),
    ProposalIdCounter,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Global administrator with full control.
    Admin = 0,
    /// Account authorized to mint tokens.
    Minter = 1,
}

/// Types of critical administrative actions that require multi-signature approval.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum CriticalAction {
    /// Change the contract administrator.
    ChangeAdmin = 0,
    /// Modify the admin pool or threshold.
    ModifyAdminPool = 1,
    /// Pause or unpause contract operations.
    PauseContract = 2,
    /// Upgrade contract implementation.
    UpgradeContract = 3,
    /// Change critical contract parameters.
    ChangeParameters = 4,
    /// Mint tokens (if applicable).
    MintTokens = 5,
    /// Burn tokens (if applicable).
    BurnTokens = 6,
    /// Transfer ownership of contract.
    TransferOwnership = 7,
}

/// Enumeration of available roles.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Global administrator with full control.
    Admin,
    Minter,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Proposal {
    pub creator: Address,
    /// The type of critical action this proposal addresses.
    pub action_type: CriticalAction,
    /// Description or metadata about the proposal.
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
    grant_role(env, Role::Admin, admin);
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

/// Grants a role to an address. Only callable by an Admin when the contract is initialized.
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

// ─── Multi-Sig Primitives ───────────────────────────────────────────────────

/// Configures the multi-signature admin pool and quorum threshold.
///
/// When a pool is configured, every member receives the Admin role and the first
/// pool member becomes the legacy primary admin for backward compatibility.
// ─── Guards ──────────────────────────────────────────────────────────────────

/// Requires that the stored admin has authorized the current invocation.
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
    if pool.is_empty() {
        panic!("admin pool cannot be empty");
    }
    if threshold == 0 || threshold > pool.len() {
        panic!("invalid threshold for admin pool");
    }
    if has_admin(env) {
        require_admin(env);
    }

    env.storage().instance().set(&AdminKey::AdminPool, &pool);
    env.storage().instance().set(&AdminKey::Threshold, &threshold);

    if let Some(primary) = pool.get(0) {
        env.storage().instance().set(&AdminKey::Admin, &primary);
    }
    for i in 0..pool.len() {
        if let Some(member) = pool.get(i) {
            env.storage()
                .persistent()
                .set(&AdminKey::Role(Role::Admin, member.clone()), &true);
        }
    }
    env.storage()
        .instance()
        .set(&AdminKey::Threshold, &threshold);
    extend_instance_ttl(env);
}

pub fn get_admin_pool(env: &Env) -> Vec<Address> {
    env.storage().instance().get(&AdminKey::AdminPool).unwrap_or_else(|| {
        if has_admin(env) {
            vec![env, get_admin(env)]
        } else {
            vec![env]
        }
    })
}

pub fn get_threshold(env: &Env) -> u32 {
    env.storage().instance().get(&AdminKey::Threshold).unwrap_or(1)
}

/// Returns `true` when the address belongs to the configured admin pool.
pub fn is_pool_member(env: &Env, address: &Address) -> bool {
    get_admin_pool(env).contains(address)
}

/// Configures whether a specific critical action requires multi-signature approval.
pub fn set_multi_sig_required(env: &Env, action: CriticalAction, required: bool) {
    require_admin(env);
    env.storage()
        .instance()
        .set(&AdminKey::MultiSigRequired(action), &required);
}

/// Checks if a specific critical action requires multi-signature approval.
pub fn is_multi_sig_required(env: &Env, action: CriticalAction) -> bool {
    env.storage()
        .instance()
        .get(&AdminKey::MultiSigRequired(action))
        .unwrap_or(false)
}

/// Checks if multi-signature is enabled for the contract.
pub fn is_multi_sig_enabled(env: &Env) -> bool {
    env.storage().instance().has(&AdminKey::AdminPool)
}

// ─── Guards ──────────────────────────────────────────────────────────────────

/// Requires that the stored admin has authorized the current invocation.
pub fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

/// Requires that the specified address has the given role and has authorized the invocation.
pub fn require_role(env: &Env, role: Role, address: &Address) {
    if !has_role(env, role, address) {
        panic!("unauthorized: missing role");
    }
    address.require_auth();
}

/// Requires that the caller belongs to the admin pool and has authorized the invocation.
pub fn require_pool_member(env: &Env, member: &Address) {
    if !is_pool_member(env, member) {
        panic!("caller is not in admin pool");
    }
    member.require_auth();
}

fn validate_proposal_for_action(env: &Env, action: CriticalAction, proposal_id: u64) {
    let proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if proposal.action_type != action {
        panic!("proposal action type does not match required action");
    }
    if !is_proposal_ready(env, proposal_id) {
        panic!("multi-signature threshold not met for critical action");
    }
}

/// Requires multi-signature approval for a critical action.
/// Falls back to single admin approval when multi-sig is not configured for the action.
pub fn require_multi_sig(env: &Env, action: CriticalAction, proposal_id: u64) {
    if is_multi_sig_required(env, action) && is_multi_sig_enabled(env) {
        validate_proposal_for_action(env, action, proposal_id);
    } else {
        require_admin(env);
    }
}

/// Requires multi-signature approval for a critical action with a specific caller.
/// Ensures the caller is part of the admin pool when multi-sig is active.
pub fn require_multi_sig_with_caller(
    env: &Env,
    action: CriticalAction,
    proposal_id: u64,
    caller: &Address,
) {
    if is_multi_sig_required(env, action) && is_multi_sig_enabled(env) {
        validate_proposal_for_action(env, action, proposal_id);
        if !is_pool_member(env, caller) {
            panic!("caller is not in admin pool");
        }
    } else {
        require_admin(env);
    }
}

    env.storage()
        .instance()
        .get(&AdminKey::Threshold)
        .unwrap_or(1);
    extend_instance_ttl(env);
    threshold
}

// ─── Proposals ──────────────────────────────────────────────────────────────

/// Creates a new proposal for an administrative action.
pub fn create_proposal(
    env: &Env,
    creator: Address,
    action_type: CriticalAction,
    description: String,
) -> u64 {
}

pub fn create_proposal(env: &Env, creator: Address, description: String) -> u64 {
    creator.require_auth();
    if !is_pool_member(env, &creator) {
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
    if !is_pool_member(env, &admin) {
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
    fn test_grant_role_extends_ttl_across_ledger_advances() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let role_holder = Address::generate(&env);

        client.set_admin(&admin);
        client.grant_role(&Role::Minter, &role_holder);

        env.ledger().set(env.ledger().sequence() + 200);
        assert!(client.has_role(&Role::Minter, &role_holder));
    }
}

/// Executes a proposal after it has met the threshold.
/// Returns the action type of the executed proposal.
pub fn execute_proposal(env: &Env, proposal_id: u64) -> CriticalAction {
    let mut proposal: Proposal = env
        .storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if !is_proposal_ready(env, proposal_id) {
        panic!("threshold not met for execution");
    }

    proposal.executed = true;
    let action_type = proposal.action_type;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
    action_type
}

/// Gets the proposal details by ID.
pub fn get_proposal(env: &Env, proposal_id: u64) -> Proposal {
    env.storage()
        .instance()
        .get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl};

    #[contract]
    struct AdminContract;

    #[contractimpl]
    impl AdminContract {
        pub fn set(env: Env, admin: Address) {
            set_admin(&env, &admin);
        }
        pub fn set_pool(env: Env, admins: Vec<Address>, threshold: u32) {
            set_admin_pool(&env, admins, threshold);
        }
        pub fn pool(env: Env) -> Vec<Address> {
            get_admin_pool(&env)
        }
        pub fn threshold(env: Env) -> u32 {
            get_threshold(&env)
        }
        pub fn propose(env: Env, creator: Address, action_type: CriticalAction, desc: String) -> u64 {
            create_proposal(&env, creator, action_type, desc)
        }
        pub fn approve(env: Env, admin: Address, id: u64) {
            approve_proposal(&env, admin, id);
        }
        pub fn ready(env: Env, id: u64) -> bool {
            is_proposal_ready(&env, id)
        }
        pub fn execute(env: Env, id: u64) -> CriticalAction {
            execute_proposal(&env, id)
        }
        pub fn set_multi_sig_required(env: Env, action: CriticalAction, required: bool) {
            set_multi_sig_required(&env, action, required);
        }
        pub fn is_multi_sig_required(env: Env, action: CriticalAction) -> bool {
            is_multi_sig_required(&env, action)
        }
        pub fn require_ms(env: Env, action: CriticalAction, proposal_id: u64) {
            require_multi_sig(&env, action, proposal_id);
        }
        pub fn admin(env: Env) -> Address {
            get_admin(&env)
        }
        pub fn multi_sig_enabled(env: Env) -> bool {
            is_multi_sig_enabled(&env)
        }
        pub fn pool_member(env: Env, address: Address) -> bool {
            is_pool_member(&env, &address)
        }
        pub fn has_admin_role(env: Env, address: Address) -> bool {
            has_role(&env, Role::Admin, &address)
        }
    }

    #[test]
    fn test_set_and_get_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set(&admin);
        assert_eq!(client.admin(), admin);
    }

    #[test]
    fn test_admin_pool_storage() {
        let env = Env::default();
        env.mock_all_auths();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set_pool(
            &vec![&env, admin1.clone(), admin2.clone(), admin3.clone()],
            &2,
        );

        assert!(client.multi_sig_enabled());
        assert_eq!(client.threshold(), 2);
        assert_eq!(client.pool().len(), 3);
        assert!(client.pool_member(&admin1));
        assert!(client.has_admin_role(&admin2));
        assert_eq!(client.admin(), admin1);
    }

    #[test]
    fn test_multi_sig() {
        let env = Env::default();
        env.mock_all_auths();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set_pool(
            &vec![&env, admin1.clone(), admin2.clone(), admin3.clone()],
            &2,
        );

        let id = client.propose(
            &admin1,
            &CriticalAction::ChangeAdmin,
            &String::from_str(&env, "test"),
        );
        assert!(!client.ready(&id));

        client.approve(&admin2, &id);
        assert!(client.ready(&id));
    }

    #[test]
    fn test_multi_sig_with_critical_actions() {
        let env = Env::default();
        env.mock_all_auths();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set_pool(
            &vec![&env, admin1.clone(), admin2.clone(), admin3.clone()],
            &2,
        );
        client.set_multi_sig_required(&CriticalAction::ChangeAdmin, &true);
        assert!(client.is_multi_sig_required(&CriticalAction::ChangeAdmin));

        let id = client.propose(
            &admin1,
            &CriticalAction::ChangeAdmin,
            &String::from_str(&env, "Change admin to new address"),
        );
        assert!(!client.ready(&id));

        client.approve(&admin2, &id);
        assert!(client.ready(&id));

        let action_type = client.execute(&id);
        assert_eq!(action_type, CriticalAction::ChangeAdmin);
        assert!(client.ready(&id));
    }

    #[test]
    fn test_multi_sig_threshold_not_met() {
        let env = Env::default();
        env.mock_all_auths();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set_pool(
            &vec![&env, admin1.clone(), admin2.clone(), admin3.clone()],
            &3,
        );

        let id = client.propose(
            &admin1,
            &CriticalAction::UpgradeContract,
            &String::from_str(&env, "Upgrade contract"),
        );
        assert!(!client.ready(&id));

        client.approve(&admin2, &id);
        assert!(!client.ready(&id));

        client.approve(&admin3, &id);
        assert!(client.ready(&id));
    }

    #[test]
    fn test_multi_sig_different_action_types() {
        let env = Env::default();
        env.mock_all_auths();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set_pool(&vec![&env, admin1.clone(), admin2.clone()], &2);

        let id1 = client.propose(
            &admin1,
            &CriticalAction::ChangeAdmin,
            &String::from_str(&env, "Change admin"),
        );
        let id2 = client.propose(
            &admin1,
            &CriticalAction::PauseContract,
            &String::from_str(&env, "Pause contract"),
        );
        let id3 = client.propose(
            &admin1,
            &CriticalAction::MintTokens,
            &String::from_str(&env, "Mint tokens"),
        );

        client.approve(&admin2, &id1);
        client.approve(&admin2, &id2);
        client.approve(&admin2, &id3);

        assert!(client.ready(&id1));
        assert!(client.ready(&id2));
        assert!(client.ready(&id3));

        assert_eq!(client.execute(&id1), CriticalAction::ChangeAdmin);
        assert_eq!(client.execute(&id2), CriticalAction::PauseContract);
        assert_eq!(client.execute(&id3), CriticalAction::MintTokens);
    }

    #[test]
    fn test_multi_sig_fallback_to_single_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set(&admin);
        client.set_multi_sig_required(&CriticalAction::ChangeAdmin, &true);

        assert!(!client.multi_sig_enabled());
        client.require_ms(&CriticalAction::ChangeAdmin, &0);
    }

    #[test]
    #[should_panic(expected = "multi-signature threshold not met")]
    fn test_require_multi_sig_rejects_unapproved_proposal() {
        let env = Env::default();
        env.mock_all_auths();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);

        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set_pool(&vec![&env, admin1.clone(), admin2.clone()], &2);
        client.set_multi_sig_required(&CriticalAction::PauseContract, &true);

        let id = client.propose(
            &admin1,
            &CriticalAction::PauseContract,
            &String::from_str(&env, "Pause"),
        );

        client.require_ms(&CriticalAction::PauseContract, &id);
    }

    proposal.executed = true;
    env.storage()
        .instance()
        .set(&AdminKey::Proposal(proposal_id), &proposal);
}
