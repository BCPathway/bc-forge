// SPDX-License-Identifier: MIT
use crate::{InvoiceStatus, Recipient, SplitContract, SplitContractClient, SplitError};
use bc_forge_admin as admin;
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String, Vec};

fn setup(
    env: &Env,
) -> (
    SplitContractClient<'_>,
    BcForgeTokenClient<'_>,
    Address,
    Address,
) {
    env.mock_all_auths();

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
    // mint now requires an explicit per-minter issuance allowance (#1327).
    token_client.set_minter_allowance(&token_admin, &token_admin, &i128::MAX);

    (split_client, token_client, split_admin, token_admin)
}

#[test]
fn test_successful_batch_payout() {
    let env = Env::default();
    let (split_client, token_client, split_admin, token_admin) = setup(&env);

    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let invoice_id = 1u64;
    let total_amount = 500_000_000i128;

    token_client.mint(&token_admin, &split_client.address, &total_amount);

    let recipients = vec![
        &env,
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

    assert_eq!(
        split_client.get_invoice(&invoice_id).status,
        InvoiceStatus::Pending
    );

    split_client.release_payment(&invoice_id, &split_admin);

    let invoice = split_client.get_invoice(&invoice_id);
    assert_eq!(invoice.status, InvoiceStatus::FullyReleased);
    assert_eq!(invoice.released_amount, total_amount);
    assert_eq!(token_client.balance(&recipient1), 200_000_000);
    assert_eq!(token_client.balance(&recipient2), 300_000_000);
}

#[test]
fn test_release_rejects_already_completed() {
    let env = Env::default();
    let (split_client, token_client, split_admin, token_admin) = setup(&env);

    let recipient = Address::generate(&env);
    let invoice_id = 1u64;
    let total_amount = 100_000_000i128;

    token_client.mint(&token_admin, &split_client.address, &total_amount);

    let recipients = vec![
        &env,
        Recipient {
            to: recipient.clone(),
            amount: total_amount,
        },
    ];

    split_client.create_invoice(
        &split_admin,
        &invoice_id,
        &total_amount,
        &recipients,
        &token_client.address,
    );

    assert!(split_client
        .try_release_payment(&invoice_id, &split_admin)
        .is_ok());
    assert!(split_client
        .try_release_payment(&invoice_id, &split_admin)
        .is_err());
}

#[test]
fn test_invoice_status_flow() {
    let env = Env::default();
    let (split_client, token_client, split_admin, token_admin) = setup(&env);

    let recipient = Address::generate(&env);
    let invoice_id = 1u64;
    let total_amount = 100_000_000i128;

    token_client.mint(&token_admin, &split_client.address, &total_amount);

    let recipients = vec![
        &env,
        Recipient {
            to: recipient.clone(),
            amount: total_amount,
        },
    ];

    split_client.create_invoice(
        &split_admin,
        &invoice_id,
        &total_amount,
        &recipients,
        &token_client.address,
    );

    assert_eq!(
        split_client.get_invoice(&invoice_id).status,
        InvoiceStatus::Pending
    );
    split_client.release_payment(&invoice_id, &split_admin);
    assert_eq!(
        split_client.get_invoice(&invoice_id).status,
        InvoiceStatus::FullyReleased
    );
    assert_eq!(token_client.balance(&recipient), total_amount);
}

#[test]
fn test_failure_isolation_insufficient_balance() {
    let env = Env::default();
    let (split_client, token_client, split_admin, token_admin) = setup(&env);

    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);
    let invoice_id = 1u64;
    let total_amount = 500_000_000i128;

    token_client.mint(&token_admin, &split_client.address, &200_000_000);

    let recipients = vec![
        &env,
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
    assert_eq!(invoice.released_amount, 200_000_000);
    assert_eq!(invoice.status, InvoiceStatus::PartiallyReleased);
    assert_eq!(token_client.balance(&recipient1), 200_000_000);
    assert_eq!(token_client.balance(&recipient2), 0);
}

#[test]
fn test_create_invoice_validates_amounts() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    let recipient = Address::generate(&env);
    let recipients = vec![
        &env,
        Recipient {
            to: recipient.clone(),
            amount: 100,
        },
    ];

    assert!(split_client
        .try_create_invoice(
            &split_admin,
            &1u64,
            &100i128,
            &recipients,
            &token_client.address
        )
        .is_ok());

    assert!(split_client
        .try_create_invoice(
            &split_admin,
            &2u64,
            &0i128,
            &recipients,
            &token_client.address
        )
        .is_err());
}

#[test]
fn test_batch_release_releases_all_invoices() {
    let env = Env::default();
    let (split_client, token_client, split_admin, token_admin) = setup(&env);

    let recipient1 = Address::generate(&env);
    let recipient2 = Address::generate(&env);

    token_client.mint(&token_admin, &split_client.address, &300_000);

    let recipients1 = vec![
        &env,
        Recipient {
            to: recipient1.clone(),
            amount: 100_000,
        },
    ];
    let recipients2 = vec![
        &env,
        Recipient {
            to: recipient2.clone(),
            amount: 200_000,
        },
    ];

    split_client.create_invoice(
        &split_admin,
        &1u64,
        &100_000i128,
        &recipients1,
        &token_client.address,
    );
    split_client.create_invoice(
        &split_admin,
        &2u64,
        &200_000i128,
        &recipients2,
        &token_client.address,
    );

    let released = split_client.release_payment_batch(&vec![&env, 1u64, 2u64]);
    assert_eq!(released, vec![&env, 1u64, 2u64]);

    assert_eq!(
        split_client.get_invoice(&1).status,
        InvoiceStatus::FullyReleased
    );
    assert_eq!(
        split_client.get_invoice(&2).status,
        InvoiceStatus::FullyReleased
    );
    assert_eq!(token_client.balance(&recipient1), 100_000);
    assert_eq!(token_client.balance(&recipient2), 200_000);
}

#[test]
fn test_batch_release_skips_failed_invoices() {
    let env = Env::default();
    let (split_client, token_client, split_admin, token_admin) = setup(&env);

    let recipient = Address::generate(&env);
    token_client.mint(&token_admin, &split_client.address, &100_000);

    let recipients = vec![
        &env,
        Recipient {
            to: recipient.clone(),
            amount: 100_000,
        },
    ];
    split_client.create_invoice(
        &split_admin,
        &1u64,
        &100_000i128,
        &recipients,
        &token_client.address,
    );

    // Invoice 99 does not exist and invoice 1 has not been released yet; the
    // batch must still process invoice 1 and report only that ID.
    let released = split_client.release_payment_batch(&vec![&env, 99u64, 1u64]);
    assert_eq!(released, vec![&env, 1u64]);
    assert_eq!(token_client.balance(&recipient), 100_000);

    // Re-running the batch skips the now-completed invoice without reverting.
    let released_again = split_client.release_payment_batch(&vec![&env, 1u64]);
    assert_eq!(released_again, vec![&env]);
}

#[test]
fn test_create_invoice_rejects_too_many_recipients() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    let mut recipients = Vec::new(&env);
    for _ in 0..101 {
        recipients.push_back(Recipient {
            to: Address::generate(&env),
            amount: 1,
        });
    }

    assert_eq!(
        split_client.try_create_invoice(
            &split_admin,
            &1u64,
            &101i128,
            &recipients,
            &token_client.address
        ),
        Err(Ok(SplitError::TooManyRecipients))
    );

    // Exactly 100 recipients is still accepted.
    recipients.pop_back();
    assert!(split_client
        .try_create_invoice(
            &split_admin,
            &1u64,
            &100i128,
            &recipients,
            &token_client.address
        )
        .is_ok());
}

#[test]
fn test_create_invoice_rejects_duplicate_recipients() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    let recipient = Address::generate(&env);
    let recipients = vec![
        &env,
        Recipient {
            to: recipient.clone(),
            amount: 50,
        },
        Recipient {
            to: recipient,
            amount: 50,
        },
    ];

    assert_eq!(
        split_client.try_create_invoice(
            &split_admin,
            &1u64,
            &100i128,
            &recipients,
            &token_client.address
        ),
        Err(Ok(SplitError::DuplicateRecipient))
    );
}

#[test]
fn test_rescue_tokens_admin_recovers_foreign_token() {
    let env = Env::default();
    let (split_client, _token_client, split_admin, token_admin) = setup(&env);

    let foreign_id = env.register(BcForgeToken, ());
    let foreign_client = BcForgeTokenClient::new(&env, &foreign_id);
    foreign_client.initialize(
        &token_admin,
        &7,
        &String::from_str(&env, "F"),
        &String::from_str(&env, "F"),
    );
    foreign_client.set_minter_allowance(&token_admin, &token_admin, &i128::MAX);

    let recovery = Address::generate(&env);
    foreign_client.mint(&token_admin, &split_client.address, &5_000);

    split_client.rescue_tokens(&split_admin, &foreign_id, &recovery, &5_000);

    assert_eq!(foreign_client.balance(&recovery), 5_000);
    assert_eq!(foreign_client.balance(&split_client.address), 0);
}

#[test]
fn test_rescue_tokens_rejects_non_admin() {
    let env = Env::default();
    let (split_client, _token_client, _split_admin, token_admin) = setup(&env);

    let foreign_id = env.register(BcForgeToken, ());
    let foreign_client = BcForgeTokenClient::new(&env, &foreign_id);
    foreign_client.initialize(
        &token_admin,
        &7,
        &String::from_str(&env, "F"),
        &String::from_str(&env, "F"),
    );
    foreign_client.set_minter_allowance(&token_admin, &token_admin, &i128::MAX);
    foreign_client.mint(&token_admin, &split_client.address, &5_000);

    let stranger = Address::generate(&env);
    let recovery = Address::generate(&env);
    assert!(split_client
        .try_rescue_tokens(&stranger, &foreign_id, &recovery, &1_000)
        .is_err());
    assert_eq!(foreign_client.balance(&split_client.address), 5_000);
}

#[test]
fn test_rescue_tokens_rejects_invalid_amount() {
    let env = Env::default();
    let (split_client, _token_client, split_admin, token_admin) = setup(&env);

    let foreign_id = env.register(BcForgeToken, ());
    let foreign_client = BcForgeTokenClient::new(&env, &foreign_id);
    foreign_client.initialize(
        &token_admin,
        &7,
        &String::from_str(&env, "F"),
        &String::from_str(&env, "F"),
    );
    foreign_client.set_minter_allowance(&token_admin, &token_admin, &i128::MAX);
    foreign_client.mint(&token_admin, &split_client.address, &5_000);

    let recovery = Address::generate(&env);
    assert_eq!(
        split_client.try_rescue_tokens(&split_admin, &foreign_id, &recovery, &0),
        Err(Ok(SplitError::InvalidAmount))
    );
    assert_eq!(
        split_client.try_rescue_tokens(&split_admin, &foreign_id, &recovery, &-1),
        Err(Ok(SplitError::InvalidAmount))
    );
    assert_eq!(foreign_client.balance(&split_client.address), 5_000);
}

#[test]
fn test_get_failed_payout_no_invoice() {
    let env = Env::default();
    let (split_client, _token_client, _split_admin, _token_admin) = setup(&env);

    let result = split_client.try_get_failed_payout(&1u64, &Address::generate(&env));
    assert!(result.is_err());
}

#[soroban_sdk::contract]
pub struct ReenteringTokenContract;

#[soroban_sdk::contractimpl]
impl ReenteringTokenContract {
    pub fn balance(_env: Env, _id: Address) -> i128 {
        1_000_000
    }

    pub fn transfer(env: Env, _from: Address, _to: Address, _amount: i128) {
        let split_id = env
            .storage()
            .instance()
            .get::<_, Address>(&soroban_sdk::Symbol::new(&env, "split"))
            .unwrap();
        let admin = env
            .storage()
            .instance()
            .get::<_, Address>(&soroban_sdk::Symbol::new(&env, "admin"))
            .unwrap();

        let split_client = SplitContractClient::new(&env, &split_id);
        split_client.release_payment(&1u64, &admin);
    }
}

#[test]
fn test_reentrancy_on_split_release_reverts() {
    let env = Env::default();
    env.mock_all_auths();

    let split_id = env.register(SplitContract, ());
    let split_client = SplitContractClient::new(&env, &split_id);
    let split_admin = Address::generate(&env);

    env.as_contract(&split_id, || {
        admin::set_admin(&env, &split_admin);
    });

    let reentering_token_id = env.register(ReenteringTokenContract, ());

    env.as_contract(&reentering_token_id, || {
        env.storage()
            .instance()
            .set(&soroban_sdk::Symbol::new(&env, "split"), &split_id);
        env.storage()
            .instance()
            .set(&soroban_sdk::Symbol::new(&env, "admin"), &split_admin);
    });

    let recipient = Address::generate(&env);
    let recipients = vec![
        &env,
        Recipient {
            to: recipient,
            amount: 100,
        },
    ];

    split_client.create_invoice(
        &split_admin,
        &1u64,
        &100i128,
        &recipients,
        &reentering_token_id,
    );

    let result = split_client.try_release_payment(&1u64, &split_admin);
    assert!(result.is_err());
}
