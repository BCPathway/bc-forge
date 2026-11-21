// SPDX-License-Identifier: MIT
use crate::{Invoice, InvoiceStatus, Recipient, SplitContract, SplitContractClient};
use bc_forge_admin as admin;
use bc_forge_token::{BcForgeToken, BcForgeTokenClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, Env, String};

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

// ─── Invoice keyset pagination (#1467) ────────────────────────────────────────

fn create_invoice_for_listing(
    env: &Env,
    split_client: &SplitContractClient<'_>,
    split_admin: &Address,
    token: &Address,
    invoice_id: u64,
) {
    let recipients = vec![
        env,
        Recipient {
            to: Address::generate(env),
            amount: 1_000,
        },
    ];
    split_client.create_invoice(split_admin, &invoice_id, &1_000, &recipients, token);
}

fn invoice_ids(env: &Env, invoices: &soroban_sdk::Vec<Invoice>) -> soroban_sdk::Vec<u64> {
    let mut ids = soroban_sdk::Vec::new(env);
    for invoice in invoices.iter() {
        ids.push_back(invoice.invoice_id);
    }
    ids
}

#[test]
fn test_list_invoices_empty_when_none_created() {
    let env = Env::default();
    let (split_client, _token_client, _split_admin, _token_admin) = setup(&env);

    let page = split_client.list_invoices(&0, &10);
    assert_eq!(page.len(), 0);
}

#[test]
fn test_list_invoices_returns_created_invoices_in_id_order() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    for id in &[3u64, 1, 2] {
        create_invoice_for_listing(
            &env,
            &split_client,
            &split_admin,
            &token_client.address,
            *id,
        );
    }

    let page = split_client.list_invoices(&0, &10);
    assert_eq!(invoice_ids(&env, &page), vec![&env, 1u64, 2, 3]);
    for invoice in page.iter() {
        assert_eq!(invoice.status, InvoiceStatus::Pending);
        assert_eq!(invoice.total_amount, 1_000);
    }
}

#[test]
fn test_list_invoices_keyset_pagination() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    for id in 1..=5u64 {
        create_invoice_for_listing(&env, &split_client, &split_admin, &token_client.address, id);
    }

    let first = split_client.list_invoices(&0, &2);
    assert_eq!(invoice_ids(&env, &first), vec![&env, 1u64, 2]);

    let second = split_client.list_invoices(&2, &2);
    assert_eq!(invoice_ids(&env, &second), vec![&env, 3u64, 4]);

    let third = split_client.list_invoices(&4, &2);
    assert_eq!(invoice_ids(&env, &third), vec![&env, 5u64]);

    let exhausted = split_client.list_invoices(&5, &2);
    assert_eq!(exhausted.len(), 0);
}

#[test]
fn test_list_invoices_caps_limit_at_fifty() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    for id in 1..=60u64 {
        create_invoice_for_listing(&env, &split_client, &split_admin, &token_client.address, id);
    }

    let first = split_client.list_invoices(&0, &100);
    assert_eq!(first.len(), 50);
    assert_eq!(first.get(0).unwrap().invoice_id, 1);
    assert_eq!(first.get(49).unwrap().invoice_id, 50);

    let second = split_client.list_invoices(&50, &u32::MAX);
    assert_eq!(second.len(), 10);
    assert_eq!(second.get(0).unwrap().invoice_id, 51);
    assert_eq!(second.get(9).unwrap().invoice_id, 60);
}

#[test]
fn test_list_invoices_skips_missing_ids_and_zero_limit() {
    let env = Env::default();
    let (split_client, token_client, split_admin, _token_admin) = setup(&env);

    for id in &[1u64, 3, 5] {
        create_invoice_for_listing(
            &env,
            &split_client,
            &split_admin,
            &token_client.address,
            *id,
        );
    }

    assert_eq!(
        invoice_ids(&env, &split_client.list_invoices(&0, &10)),
        vec![&env, 1u64, 3, 5]
    );
    assert_eq!(
        invoice_ids(&env, &split_client.list_invoices(&3, &10)),
        vec![&env, 5u64]
    );
    assert_eq!(split_client.list_invoices(&0, &0).len(), 0);
}
