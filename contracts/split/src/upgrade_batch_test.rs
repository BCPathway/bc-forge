//! Integration tests for multi-contract upgrade batching (#674).
//!
//! Covers: batch proposals on token + split → sequential execute →
//! inter-contract calls still succeed on ABI-compatible post-upgrade instances.

use crate::{InvoiceStatus, Recipient, SplitContract, SplitContractClient};
use bc_forge_admin as admin;
use bc_forge_admin::AdminError;
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{vec, Address, BytesN, Env, String};

fn advance_past_timelock(env: &Env) {
    let mut ledger_info = env.ledger().get();
    ledger_info.timestamp += admin::TIMELOCK_DELAY_SECS + 1;
    env.ledger().set(ledger_info);
}

fn uploaded_wasm_hash(env: &Env) -> BytesN<32> {
    // Empty wasm is accepted by Soroban testutils and is enough to exercise
    // `update_current_contract_wasm` inside the sandbox.
    env.deployer()
        .upload_contract_wasm(soroban_sdk::Bytes::from_slice(env, &[]))
}

fn setup_multisig_pair(
    env: &Env,
) -> (
    SplitContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
) {
    env.mock_all_auths();

    let governor_a = Address::generate(env);
    let governor_b = Address::generate(env);

    let split_id = env.register(SplitContract, ());
    let split_client = SplitContractClient::new(env, &split_id);
    env.as_contract(&split_id, || {
        admin::set_admin(env, &governor_a);
    });
    split_client.set_admin_pool(&vec![env, governor_a.clone(), governor_b.clone()], &2);

    let token_id = env.register(BcForgeToken, ());
    let token_client = BcForgeTokenClient::new(env, &token_id);
    token_client.initialize(
        &governor_a,
        &7,
        &String::from_str(env, "T"),
        &String::from_str(env, "T"),
    );
    token_client.set_admin_pool(&vec![env, governor_a.clone(), governor_b.clone()], &2);

    (split_client, token_client, governor_a, governor_b)
}

fn assert_inter_contract_payout_succeeds(env: &Env) {
    // Fresh ABI-compatible token + split pair (models post-upgrade contracts
    // that keep the same interface). Verifies mint → invoice → release still works.
    let split_id = env.register(SplitContract, ());
    let split_client = SplitContractClient::new(env, &split_id);
    let split_admin = Address::generate(env);
    env.as_contract(&split_id, || {
        admin::set_admin(env, &split_admin);
    });

    let token_id = env.register(BcForgeToken, ());
    let token_client = BcForgeTokenClient::new(env, &token_id);
    let token_admin = Address::generate(env);
    token_client.initialize(
        &token_admin,
        &7,
        &String::from_str(env, "T"),
        &String::from_str(env, "T"),
    );

    let recipient1 = Address::generate(env);
    let recipient2 = Address::generate(env);
    let invoice_id = 1u64;
    let total_amount = 500_000_000i128;

    token_client.mint(&token_admin, &split_client.address, &total_amount);

    let recipients = vec![
        env,
        Recipient {
            to: recipient1.clone(),
            amount: 200_000_000,
        },
        Recipient {
            to: recipient2.clone(),
            amount: 300_000_000,
        },
    ];

    split_client.create_invoice(
        &split_admin,
        &invoice_id,
        &total_amount,
        &recipients,
        &token_client.address,
    );

    split_client.release_payment(&invoice_id, &split_admin);

    let invoice = split_client.get_invoice(&invoice_id);
    assert_eq!(invoice.status, InvoiceStatus::FullyReleased);
    assert_eq!(invoice.released_amount, total_amount);
    assert_eq!(token_client.balance(&recipient1), 200_000_000);
    assert_eq!(token_client.balance(&recipient2), 300_000_000);
}

#[test]
fn test_batch_token_and_split_upgrades_then_inter_contract_calls_succeed() {
    let env = Env::default();
    let (split_client, token_client, gov_a, gov_b) = setup_multisig_pair(&env);

    // 1) Batch proposals for multiple contracts
    let token_proposal =
        token_client.create_proposal(&gov_a, &String::from_str(&env, "upgrade token wasm"));
    let split_proposal =
        split_client.create_proposal(&gov_a, &String::from_str(&env, "upgrade split wasm"));

    // Meet quorum (2-of-2) on both
    token_client.approve_proposal(&gov_b, &token_proposal);
    split_client.approve_proposal(&gov_b, &split_proposal);
    assert!(token_client.is_proposal_ready(&token_proposal));
    assert!(split_client.is_proposal_ready(&split_proposal));

    let token_wasm = uploaded_wasm_hash(&env);
    let split_wasm = uploaded_wasm_hash(&env);
    advance_past_timelock(&env);

    // 2) Execute in sequence: token, then split
    token_client.execute_upgrade(&gov_a, &token_proposal, &token_wasm);
    split_client.execute_upgrade(&gov_a, &split_proposal, &split_wasm);

    // Upgrades are one-shot
    assert_eq!(
        token_client.try_execute_upgrade(&gov_b, &token_proposal, &token_wasm),
        Err(Ok(AdminError::ProposalAlreadyExecuted))
    );
    assert_eq!(
        split_client.try_execute_upgrade(&gov_b, &split_proposal, &split_wasm),
        Err(Ok(AdminError::ProposalAlreadyExecuted))
    );

    // 3) Verify inter-contract calls succeed on ABI-compatible upgraded instances
    assert_inter_contract_payout_succeeds(&env);
}

#[test]
fn test_batch_upgrade_rejects_when_split_quorum_not_met() {
    let env = Env::default();
    let (split_client, token_client, gov_a, gov_b) = setup_multisig_pair(&env);

    let token_proposal =
        token_client.create_proposal(&gov_a, &String::from_str(&env, "upgrade token"));
    let split_proposal =
        split_client.create_proposal(&gov_a, &String::from_str(&env, "upgrade split"));

    // Only token reaches quorum; split stays at creator-only approval.
    token_client.approve_proposal(&gov_b, &token_proposal);
    assert!(token_client.is_proposal_ready(&token_proposal));
    assert!(!split_client.is_proposal_ready(&split_proposal));

    let wasm = uploaded_wasm_hash(&env);
    advance_past_timelock(&env);

    token_client.execute_upgrade(&gov_a, &token_proposal, &wasm);

    assert_eq!(
        split_client.try_execute_upgrade(&gov_a, &split_proposal, &wasm),
        Err(Ok(AdminError::QuorumNotMet))
    );

    // After the missing approval arrives, the split leg of the batch can finish.
    split_client.approve_proposal(&gov_b, &split_proposal);
    advance_past_timelock(&env);
    split_client.execute_upgrade(&gov_a, &split_proposal, &wasm);
}

#[test]
fn test_batch_upgrade_rejects_non_pool_executor_on_either_contract() {
    let env = Env::default();
    let (split_client, token_client, gov_a, gov_b) = setup_multisig_pair(&env);
    let stranger = Address::generate(&env);

    let token_proposal =
        token_client.create_proposal(&gov_a, &String::from_str(&env, "upgrade token"));
    let split_proposal =
        split_client.create_proposal(&gov_a, &String::from_str(&env, "upgrade split"));
    token_client.approve_proposal(&gov_b, &token_proposal);
    split_client.approve_proposal(&gov_b, &split_proposal);

    let wasm = uploaded_wasm_hash(&env);

    assert_eq!(
        token_client.try_execute_upgrade(&stranger, &token_proposal, &wasm),
        Err(Ok(AdminError::UnauthorizedRole))
    );
    assert_eq!(
        split_client.try_execute_upgrade(&stranger, &split_proposal, &wasm),
        Err(Ok(AdminError::UnauthorizedRole))
    );

    // Pool members can still complete the batch afterwards.
    advance_past_timelock(&env);
    token_client.execute_upgrade(&gov_a, &token_proposal, &wasm);
    split_client.execute_upgrade(&gov_a, &split_proposal, &wasm);
}

#[test]
fn test_execute_upgrade_batch_rejects_length_mismatch() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(SplitContract, ());
    let admin_addr = Address::generate(&env);
    env.as_contract(&contract_id, || {
        admin::set_admin(&env, &admin_addr);
        let id = admin::create_proposal(&env, admin_addr.clone(), String::from_str(&env, "solo"));
        let wasm = uploaded_wasm_hash(&env);
        let ids = vec![&env, id];
        let hashes = vec![&env, wasm.clone(), wasm];
        assert_eq!(
            admin::execute_upgrade_batch(&env, admin_addr, ids, hashes),
            Err(AdminError::BatchLengthMismatch)
        );
    });
}
