//! Multi-signature governance storage and contract logic.

#![no_std]

#[cfg(test)]
extern crate std;

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, vec, Address, Env, Vec};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Signers,
    Threshold,
    ExpiryLedgers,
    NextProposalId,
    Proposal(u64),
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum Action {
    Mint(Address, i128),
    Pause,
    Unpause,
    TransferOwnership(Address),
    UpdateThreshold(u32),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum ProposalStatus {
    Pending,
    Executed,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Proposal {
    pub id: u64,
    pub action: Action,
    pub proposer: Address,
    pub approvals: Vec<Address>,
    pub expiry_ledger: u32,
    pub status: ProposalStatus,
}

#[contract]
pub struct MultiSigGovernance;

#[contractimpl]
impl MultiSigGovernance {
    pub fn initialize(env: Env, signers: Vec<Address>, threshold: u32, expiry_ledgers: u32) {
        initialize(&env, signers, threshold, expiry_ledgers);
    }

    pub fn signers(env: Env) -> Vec<Address> {
        signers(&env)
    }

    pub fn threshold(env: Env) -> u32 {
        threshold(&env)
    }

    pub fn propose(env: Env, proposer: Address, action: Action) -> u64 {
        propose(&env, proposer, action)
    }

    pub fn approve(env: Env, signer: Address, proposal_id: u64) {
        approve(&env, signer, proposal_id);
    }

    pub fn execute(env: Env, proposal_id: u64) -> Action {
        execute(&env, proposal_id)
    }

    pub fn reject(env: Env, signer: Address, proposal_id: u64) {
        reject(&env, signer, proposal_id);
    }

    pub fn proposal(env: Env, proposal_id: u64) -> Proposal {
        proposal(&env, proposal_id)
    }
}

pub fn initialize(env: &Env, signers: Vec<Address>, threshold: u32, expiry_ledgers: u32) {
    validate_config(&signers, threshold, expiry_ledgers);
    ensure_unique_signers(&signers);

    env.storage().instance().set(&DataKey::Signers, &signers);
    env.storage().instance().set(&DataKey::Threshold, &threshold);
    env.storage()
        .instance()
        .set(&DataKey::ExpiryLedgers, &expiry_ledgers);
    if !env.storage().instance().has(&DataKey::NextProposalId) {
        env.storage().instance().set(&DataKey::NextProposalId, &0_u64);
    }
    env.events().publish(
        (symbol_short!("gov_init"),),
        (signers.len(), threshold, expiry_ledgers),
    );
}

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Signers)
}

pub fn signers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::Signers)
        .expect("governance not initialized")
}

pub fn threshold(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::Threshold)
        .expect("governance not initialized")
}

pub fn propose(env: &Env, proposer: Address, action: Action) -> u64 {
    proposer.require_auth();
    require_signer(env, &proposer);

    let id = next_id(env);
    let expiry_ledgers: u32 = env
        .storage()
        .instance()
        .get(&DataKey::ExpiryLedgers)
        .expect("governance not initialized");
    let proposal = Proposal {
        id,
        action,
        proposer: proposer.clone(),
        approvals: vec![env, proposer.clone()],
        expiry_ledger: env.ledger().sequence() + expiry_ledgers,
        status: ProposalStatus::Pending,
    };

    env.storage()
        .instance()
        .set(&DataKey::Proposal(id), &proposal);
    env.events()
        .publish((symbol_short!("propose"),), (id, proposer));
    id
}

pub fn approve(env: &Env, signer: Address, proposal_id: u64) {
    signer.require_auth();
    require_signer(env, &signer);

    let mut proposal = proposal(env, proposal_id);
    ensure_pending(env, &proposal);
    if proposal.approvals.contains(&signer) {
        panic!("signer already approved proposal");
    }

    proposal.approvals.push_back(signer.clone());
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);
    env.events()
        .publish((symbol_short!("approve"),), (proposal_id, signer));
}

pub fn execute(env: &Env, proposal_id: u64) -> Action {
    let mut proposal = proposal(env, proposal_id);
    ensure_pending(env, &proposal);
    if proposal.approvals.len() < threshold(env) {
        panic!("approval threshold not met");
    }

    proposal.status = ProposalStatus::Executed;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);
    env.events()
        .publish((symbol_short!("execute"),), (proposal_id, proposal.approvals.len()));

    match proposal.action.clone() {
        Action::UpdateThreshold(new_threshold) => {
            set_threshold(env, new_threshold);
            Action::UpdateThreshold(new_threshold)
        }
        action => action,
    }
}

pub fn reject(env: &Env, signer: Address, proposal_id: u64) {
    signer.require_auth();
    require_signer(env, &signer);

    let mut proposal = proposal(env, proposal_id);
    ensure_pending(env, &proposal);
    proposal.status = ProposalStatus::Rejected;
    env.storage()
        .instance()
        .set(&DataKey::Proposal(proposal_id), &proposal);
    env.events()
        .publish((symbol_short!("reject"),), (proposal_id, signer));
}

pub fn proposal(env: &Env, proposal_id: u64) -> Proposal {
    env.storage()
        .instance()
        .get(&DataKey::Proposal(proposal_id))
        .expect("proposal not found")
}

pub fn set_threshold(env: &Env, new_threshold: u32) {
    let signer_count = signers(env).len();
    if new_threshold == 0 || new_threshold > signer_count {
        panic!("invalid threshold");
    }
    let old_threshold = threshold(env);
    env.storage()
        .instance()
        .set(&DataKey::Threshold, &new_threshold);
    env.events()
        .publish((symbol_short!("thresh"),), (old_threshold, new_threshold));
}

fn next_id(env: &Env) -> u64 {
    let id = env
        .storage()
        .instance()
        .get(&DataKey::NextProposalId)
        .unwrap_or(0_u64);
    env.storage()
        .instance()
        .set(&DataKey::NextProposalId, &(id + 1));
    id
}

fn validate_config(signers: &Vec<Address>, threshold: u32, expiry_ledgers: u32) {
    if signers.len() == 0 {
        panic!("at least one signer required");
    }
    if threshold == 0 || threshold > signers.len() {
        panic!("invalid threshold");
    }
    if expiry_ledgers == 0 {
        panic!("expiry ledgers must be positive");
    }
}

fn ensure_unique_signers(signers: &Vec<Address>) {
    for i in 0..signers.len() {
        let signer = signers.get(i).expect("signer should exist");
        for j in (i + 1)..signers.len() {
            if signer == signers.get(j).expect("signer should exist") {
                panic!("duplicate signer");
            }
        }
    }
}

fn require_signer(env: &Env, signer: &Address) {
    if !signers(env).contains(signer) {
        panic!("not a governance signer");
    }
}

fn ensure_pending(env: &Env, proposal: &Proposal) {
    if proposal.status != ProposalStatus::Pending {
        panic!("proposal is not pending");
    }
    if env.ledger().sequence() > proposal.expiry_ledger {
        panic!("proposal expired");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};

    fn setup(env: &Env) -> (Address, Address, Address) {
        env.mock_all_auths();
        let a = Address::generate(env);
        let b = Address::generate(env);
        let c = Address::generate(env);
        initialize(env, vec![env, a.clone(), b.clone(), c.clone()], 2, 10);
        (a, b, c)
    }

    #[test]
    fn happy_path_executes_after_threshold() {
        let env = Env::default();
        let (a, b, _) = setup(&env);
        let user = Address::generate(&env);

        let id = propose(&env, a, Action::Mint(user.clone(), 100));
        approve(&env, b, id);

        assert_eq!(execute(&env, id), Action::Mint(user, 100));
        assert_eq!(proposal(&env, id).status, ProposalStatus::Executed);
    }

    #[test]
    #[should_panic(expected = "approval threshold not met")]
    fn cannot_execute_below_threshold() {
        let env = Env::default();
        let (a, _, _) = setup(&env);
        let id = propose(&env, a, Action::Pause);

        execute(&env, id);
    }

    #[test]
    #[should_panic(expected = "invalid threshold")]
    fn rejects_threshold_above_signer_count() {
        let env = Env::default();
        env.mock_all_auths();
        let a = Address::generate(&env);
        initialize(&env, vec![&env, a], 2, 10);
    }

    #[test]
    #[should_panic(expected = "proposal expired")]
    fn expired_proposal_cannot_be_approved() {
        let env = Env::default();
        let (a, b, _) = setup(&env);
        let id = propose(&env, a, Action::Unpause);

        env.ledger().set_sequence_number(12);
        approve(&env, b, id);
    }

    #[test]
    #[should_panic(expected = "signer already approved proposal")]
    fn prevents_double_approval() {
        let env = Env::default();
        let (a, _, _) = setup(&env);
        let id = propose(&env, a.clone(), Action::Pause);

        approve(&env, a, id);
    }

    #[test]
    fn update_threshold_action_changes_threshold() {
        let env = Env::default();
        let (a, b, _) = setup(&env);
        let id = propose(&env, a, Action::UpdateThreshold(3));
        approve(&env, b, id);

        assert_eq!(execute(&env, id), Action::UpdateThreshold(3));
        assert_eq!(threshold(&env), 3);
    }
}
