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
    /// The pool of administrator addresses for multi-sig.
    AdminPool,
    /// Minimum signatures required for multi-sig actions.
    Threshold,
    /// Active proposals: proposal_id -> Proposal.
    Proposal(u64),
    /// Counter for generating unique proposal IDs.
    ProposalIdCounter,
}

/// A proposal for a multi-signature action.
#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Proposal {
    /// The admin who created the proposal.
    pub creator: Address,
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

// ─── Guards ──────────────────────────────────────────────────────────────────

/// Requires that the stored admin has authorized the current invocation.
pub fn require_admin(env: &Env) {
    let admin = get_admin(env);
    admin.require_auth();
}

// ─── Proposals ──────────────────────────────────────────────────────────────

/// Creates a new proposal for an administrative action.
pub fn create_proposal(env: &Env, creator: Address, description: String) -> u64 {
    creator.require_auth();
    let pool = get_admin_pool(env);
    if !pool.contains(&creator) {
        panic!("only admins can create proposals");
    }

    let id = env.storage().instance().get(&AdminKey::ProposalIdCounter).unwrap_or(0);
    env.storage().instance().set(&AdminKey::ProposalIdCounter, &(id + 1));

    let proposal = Proposal {
        creator: creator.clone(),
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
        pub fn propose(env: Env, creator: Address, desc: String) -> u64 {
            create_proposal(&env, creator, desc)
        }
        pub fn approve(env: Env, admin: Address, id: u64) {
            approve_proposal(&env, admin, id);
        }
        pub fn ready(env: Env, id: u64) -> bool {
            is_proposal_ready(&env, id)
        }
    }

    #[test]
    fn test_set_and_get_admin() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);

        client.set(&admin);
    }

    #[test]
    fn test_multi_sig() {
        let env = Env::default();
        let admin1 = Address::generate(&env);
        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);
        
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        
        client.set_pool(&vec![&env, admin1.clone(), admin2.clone(), admin3.clone()], 2);
        
        let id = client.propose(&admin1, &String::from_str(&env, "test"));
        assert!(!client.ready(&id));
        
        client.approve(&admin2, &id);
        assert!(client.ready(&id));
    }
}
