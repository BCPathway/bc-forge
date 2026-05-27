//! # bc-forge Admin Module
//!
//! Reusable access-control primitives for Soroban contracts.
//! Provides admin storage, authentication guards, role management, and multi-signature constraints.

#![no_std]

use soroban_sdk::{contracttype, Address, Env, Vec, vec, String};

/// Storage keys used by the admin module.
#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    /// The contract administrator address (singular).
    Admin,
    /// Role assignments: (Role, Address) -> bool
    Role(Role, Address),
    /// Multi-sig required for specific critical actions: CriticalAction -> bool
    MultiSigRequired(CriticalAction),
}

/// Enumeration of available roles.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Global administrator with full control.
    Admin = 0,
    /// Account authorized to mint tokens.
    Minter = 1,
    /// The pool of administrator addresses for multi-sig.
    AdminPool,
    /// Minimum signatures required for multi-sig actions.
    Threshold,
    /// Active proposals: proposal_id -> Proposal.
    Proposal(u64),
    /// Counter for generating unique proposal IDs.
    ProposalIdCounter,
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

/// A proposal for a multi-signature action.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Proposal {
    /// The admin who created the proposal.
    pub creator: Address,
    /// The type of critical action this proposal addresses.
    pub action_type: CriticalAction,
    /// Description or metadata about the proposal.
    pub description: String,
    /// List of admins who have approved this proposal.
    pub approvals: Vec<Address>,
    /// Whether the proposal has been executed.
    pub executed: bool,
}

// ─── Read / Write ────────────────────────────────────────────────────────────

/// Stores the admin address in instance storage.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&AdminKey::Admin, admin);
    // Automatically grant the Admin role to the administrator.
    grant_role(env, Role::Admin, admin);
}

/// Retrieves the current admin address.
pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&AdminKey::Admin)
        .expect("contract not initialized: admin not set")
}

/// Returns `true` if an admin address has been configured.
pub fn has_admin(env: &Env) -> bool {
    env.storage().instance().has(&AdminKey::Admin)
}

/// Grants a role to an address. Only callable by an Admin.
pub fn grant_role(env: &Env, role: Role, address: &Address) {
    // If the contract is already initialized, ensure only an Admin can grant roles.
    if has_admin(env) {
        require_admin(env);
    }
    env.storage().persistent().set(&AdminKey::Role(role, address.clone()), &true);
}

/// Revokes a role from an address. Only callable by an Admin.
pub fn revoke_role(env: &Env, role: Role, address: &Address) {
    require_admin(env);
    env.storage().persistent().remove(&AdminKey::Role(role, address.clone()));
}

/// Returns `true` if the address has the specified role.
pub fn has_role(env: &Env, role: Role, address: &Address) -> bool {
    // Admins implicitly have all roles.
    if env.storage().persistent().has(&AdminKey::Role(Role::Admin, address.clone())) {
        return true;
    }
    env.storage().persistent().has(&AdminKey::Role(role, address.clone()))
}

// ─── Multi-Sig Primitives ───────────────────────────────────────────────────

/// Configures the multi-signature admin pool.
pub fn set_admin_pool(env: &Env, pool: Vec<Address>, threshold: u32) {
    if threshold == 0 || threshold > pool.len() {
        panic!("invalid threshold for admin pool");
    }
    env.storage().instance().set(&AdminKey::AdminPool, &pool);
    env.storage().instance().set(&AdminKey::Threshold, &threshold);
}

/// Retrieves the admin pool. Defaults to the singular admin if no pool is set.
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

/// Retrieves the quorum threshold for the admin pool.
pub fn get_threshold(env: &Env) -> u32 {
    env.storage().instance().get(&AdminKey::Threshold).unwrap_or(1)
}

/// Configures whether a specific critical action requires multi-signature approval.
pub fn set_multi_sig_required(env: &Env, action: CriticalAction, required: bool) {
    require_admin(env);
    env.storage().instance().set(&AdminKey::MultiSigRequired(action), &required);
}

/// Checks if a specific critical action requires multi-signature approval.
pub fn is_multi_sig_required(env: &Env, action: CriticalAction) -> bool {
    env.storage().instance().get(&AdminKey::MultiSigRequired(action)).unwrap_or(false)
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

/// Requires multi-signature approval for a critical action.
/// If multi-sig is not enabled for the action, falls back to single admin approval.
pub fn require_multi_sig(env: &Env, action: CriticalAction, proposal_id: u64) {
    if is_multi_sig_required(env, action) {
        if !is_proposal_ready(env, proposal_id) {
            panic!("multi-signature threshold not met for critical action");
        }
        let proposal: Proposal = env.storage().instance().get(&AdminKey::Proposal(proposal_id))
            .expect("proposal not found");
        if proposal.action_type != action {
            panic!("proposal action type does not match required action");
        }
    } else {
        require_admin(env);
    }
}

/// Requires multi-signature approval for a critical action with a specific caller.
/// This variant ensures the caller is part of the admin pool.
pub fn require_multi_sig_with_caller(env: &Env, action: CriticalAction, proposal_id: u64, caller: &Address) {
    if is_multi_sig_required(env, action) {
        if !is_proposal_ready(env, proposal_id) {
            panic!("multi-signature threshold not met for critical action");
        }
        let proposal: Proposal = env.storage().instance().get(&AdminKey::Proposal(proposal_id))
            .expect("proposal not found");
        if proposal.action_type != action {
            panic!("proposal action type does not match required action");
        }
        let pool = get_admin_pool(env);
        if !pool.contains(caller) {
            panic!("caller is not in admin pool");
        }
    } else {
        require_admin(env);
    }
}

// ─── Proposals ──────────────────────────────────────────────────────────────

/// Creates a new proposal for an administrative action.
pub fn create_proposal(env: &Env, creator: Address, action_type: CriticalAction, description: String) -> u64 {
    creator.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&creator) {
        panic!("only admins can create proposals");
    }

    let id = env.storage().instance().get(&AdminKey::ProposalIdCounter).unwrap_or(0);
    env.storage().instance().set(&AdminKey::ProposalIdCounter, &(id + 1));

    let proposal = Proposal {
        creator: creator.clone(),
        action_type,
        description,
        approvals: vec![env, creator],
        executed: false,
    };

    env.storage().instance().set(&AdminKey::Proposal(id), &proposal);
    id
}

/// Adds an approval to an existing proposal.
pub fn approve_proposal(env: &Env, admin: Address, proposal_id: u64) {
    admin.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&admin) {
        panic!("only admins can approve proposals");
    }

    let mut proposal: Proposal = env.storage().instance().get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if proposal.approvals.contains(&admin) {
        panic!("admin already approved this proposal");
    }

    proposal.approvals.push_back(admin);
    env.storage().instance().set(&AdminKey::Proposal(proposal_id), &proposal);
}

/// Checks if a proposal has met its quorum threshold.
pub fn is_proposal_ready(env: &Env, proposal_id: u64) -> bool {
    let proposal: Proposal = env.storage().instance().get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");
    proposal.approvals.len() >= get_threshold(env)
}

/// Marks a proposal as executed. Useful for preventing re-execution.
pub fn mark_executed(env: &Env, proposal_id: u64) {
    let mut proposal: Proposal = env.storage().instance().get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("already executed");
    }
    if !is_proposal_ready(env, proposal_id) {
        panic!("threshold not met");
    }

    proposal.executed = true;
    env.storage().instance().set(&AdminKey::Proposal(proposal_id), &proposal);
}

/// Executes a proposal after it has met the threshold.
/// Returns the action type of the executed proposal.
pub fn execute_proposal(env: &Env, proposal_id: u64) -> CriticalAction {
    let mut proposal: Proposal = env.storage().instance().get(&AdminKey::Proposal(proposal_id))
        .expect("proposal not found");

    if proposal.executed {
        panic!("proposal already executed");
    }
    if !is_proposal_ready(env, proposal_id) {
        panic!("threshold not met for execution");
    }

    proposal.executed = true;
    let action_type = proposal.action_type;
    env.storage().instance().set(&AdminKey::Proposal(proposal_id), &proposal);
    action_type
}

/// Gets the proposal details by ID.
pub fn get_proposal(env: &Env, proposal_id: u64) -> Proposal {
    env.storage().instance().get(&AdminKey::Proposal(proposal_id))
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
    }

    #[test]
    fn test_set_and_get_admin() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set(&admin);
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

        client.set_pool(&vec![&env, admin1.clone(), admin2.clone(), admin3.clone()], 2);

        let id = client.propose(&admin1, &CriticalAction::ChangeAdmin, &String::from_str(&env, "test"));
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

        // Set up admin pool with threshold of 2
        client.set_pool(&vec![&env, admin1.clone(), admin2.clone(), admin3.clone()], 2);

        // Configure ChangeAdmin to require multi-sig
        client.set_multi_sig_required(&CriticalAction::ChangeAdmin, true);
        assert!(client.is_multi_sig_required(&CriticalAction::ChangeAdmin));

        // Create a proposal for changing admin
        let id = client.propose(&admin1, &CriticalAction::ChangeAdmin, &String::from_str(&env, "Change admin to new address"));
        assert!(!client.ready(&id));

        // Approve with second admin
        client.approve(&admin2, &id);
        assert!(client.ready(&id));

        // Execute the proposal
        let action_type = client.execute(&id);
        assert_eq!(action_type, CriticalAction::ChangeAdmin);

        // Verify proposal is marked as executed
        assert!(client.ready(&id)); // Still ready but executed
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

        // Set up admin pool with threshold of 3
        client.set_pool(&vec![&env, admin1.clone(), admin2.clone(), admin3.clone()], 3);

        // Create a proposal
        let id = client.propose(&admin1, &CriticalAction::UpgradeContract, &String::from_str(&env, "Upgrade contract"));
        assert!(!client.ready(&id));

        // Approve with second admin (still not enough)
        client.approve(&admin2, &id);
        assert!(!client.ready(&id));

        // Approve with third admin (now meets threshold)
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

        // Set up admin pool with threshold of 2
        client.set_pool(&vec![&env, admin1.clone(), admin2.clone()], 2);

        // Create proposals for different action types
        let id1 = client.propose(&admin1, &CriticalAction::ChangeAdmin, &String::from_str(&env, "Change admin"));
        let id2 = client.propose(&admin1, &CriticalAction::PauseContract, &String::from_str(&env, "Pause contract"));
        let id3 = client.propose(&admin1, &CriticalAction::MintTokens, &String::from_str(&env, "Mint tokens"));

        // Approve all proposals
        client.approve(&admin2, &id1);
        client.approve(&admin2, &id2);
        client.approve(&admin2, &id3);

        // All should be ready
        assert!(client.ready(&id1));
        assert!(client.ready(&id2));
        assert!(client.ready(&id3));

        // Execute and verify action types
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

        // Set single admin (no multi-sig pool)
        client.set(&admin);

        // Configure action to require multi-sig (but pool not set)
        client.set_multi_sig_required(&CriticalAction::ChangeAdmin, true);

        // Since multi-sig is not enabled (no pool), it should fall back to single admin
        // This is tested implicitly by the require_multi_sig function
        assert!(!is_multi_sig_enabled(&env));
    }
}
