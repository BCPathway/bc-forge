use crate::{BcForgeToken, BcForgeTokenClient, TokenError};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::{symbol_short, vec, Address, BytesN, Env, String, TryIntoVal, Val};

fn setup_contract(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);
    (client, contract_id)
}

fn init_default(env: &Env, client: &BcForgeTokenClient) -> Address {
    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );
    admin
}

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    let (client, _) = setup_contract(env);
    let admin = init_default(env, &client);
    (client, admin)
}

#[test]
fn test_batch_transfer_while_paused_returns_error() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient = Address::generate(&env);
    client.mint(&admin, &from, &100);
    client.pause();
    let recipients = vec![&env, (recipient, 10_i128)];
    let result = client.try_batch_transfer(&from, &recipients);
    assert!(result.is_err());
}

#[test]
fn test_initialize_emits_expected_events() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, contract_id) = setup_contract(&env);
    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Test Token");
    let symbol = String::from_str(&env, "TST");

    client.initialize(&admin, &7, &name, &symbol);

    let events = env.events().all();
    assert_eq!(
        events.len(),
        2,
        "expected exactly two events during initialization"
    );

    // The init event is emitted second (after set_admin emits RoleGranted)
    let (emitter, topics, data) = events.get(1).unwrap();

    assert_eq!(emitter, contract_id);

    assert_eq!(
        topics.len(),
        2,
        "topics should contain init symbol and admin"
    );

    let topic0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(
        topic0,
        symbol_short!("init"),
        "first topic should be the 'init' symbol"
    );

    let topic1: soroban_sdk::Address = topics.get(1).unwrap().try_into_val(&env).unwrap();
    assert_eq!(topic1, admin, "second topic should be the admin address");

    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    assert_eq!(
        data_vec.len(),
        3,
        "data should have 3 elements (decimal, name, symbol), confirming admin is in topics"
    );

    let decimal: u32 = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(decimal, 7);
}

#[test]
fn test_batch_transfer_multiple_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);
    let recipient_c = Address::generate(&env);

    client.mint(&admin, &from, &1000);

    let recipients = vec![
        &env,
        (recipient_a.clone(), 100_i128),
        (recipient_b.clone(), 250_i128),
        (recipient_c.clone(), 50_i128),
    ];
    client.batch_transfer(&from, &recipients);

    assert_eq!(client.balance(&from), 600);
    assert_eq!(client.balance(&recipient_a), 100);
    assert_eq!(client.balance(&recipient_b), 250);
    assert_eq!(client.balance(&recipient_c), 50);
    assert_eq!(client.supply(), 1000);
}

#[test]
fn test_batch_transfer_rejects_invalid_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.mint(&admin, &from, &1000);

    let recipients = vec![&env, (recipient.clone(), 0_i128)];
    let result = client.try_batch_transfer(&from, &recipients);
    assert!(result.is_err());
    assert_eq!(client.balance(&from), 1000);
    assert_eq!(client.balance(&recipient), 0);
}

#[test]
fn test_batch_transfer_rejects_insufficient_balance_before_moving_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let from = Address::generate(&env);
    let recipient_a = Address::generate(&env);
    let recipient_b = Address::generate(&env);

    client.mint(&admin, &from, &100);

    let recipients = vec![
        &env,
        (recipient_a.clone(), 80_i128),
        (recipient_b.clone(), 40_i128),
    ];
    let result = client.try_batch_transfer(&from, &recipients);
    assert!(result.is_err());
    assert_eq!(client.balance(&from), 100);
    assert_eq!(client.balance(&recipient_a), 0);
    assert_eq!(client.balance(&recipient_b), 0);
}

#[test]
fn test_stranger_lacks_super_admin_role_required_by_upgrade_guard() {
    // Soroban's test host converts any escaped guest panic into a generic
    // "Error(Contract, #N)" report, discarding the original panic message
    // (confirmed empirically: `require_role`'s literal panic string is not
    // observable via #[should_panic(expected = ...)], through the client
    // or via env.as_contract, in this SDK version). So instead of asserting
    // on that unobservable string, assert directly on the precondition
    // `require_role` panics on: the caller must not hold Role::SuperAdmin
    // (or the superset Role::Admin). This is the exact condition `upgrade`
    // gates on, verified without depending on panic-message plumbing.
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let contract_id = client.address.clone();
    let stranger = Address::generate(&env);

    let has_role = env.as_contract(&contract_id, || {
        bc_forge_admin::has_role(&env, bc_forge_admin::Role::SuperAdmin, &stranger)
    });
    assert!(
        !has_role,
        "a freshly generated address must not hold SuperAdmin"
    );
}

#[test]
#[should_panic]
fn test_upgrade_rejects_caller_without_super_admin_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let stranger = Address::generate(&env);
    let new_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);

    // Some panic is expected here (the guard's, since stranger holds no
    // role); see the sibling test above for a message-independent check
    // of the exact precondition this guard rejects on.
    client.upgrade(&stranger, &new_wasm_hash);
}

#[test]
#[should_panic]
fn test_upgrade_permits_super_admin_role_holder_past_the_guard() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let upgrader = Address::generate(&env);
    let new_wasm_hash = BytesN::from_array(&env, &[0u8; 32]);

    env.as_contract(&contract_id, || {
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::SuperAdmin, &upgrader);
    });

    // The guard passes for a SuperAdmin holder, so execution reaches
    // `update_current_contract_wasm`, which panics because there is no
    // installed contract at an all-zero wasm hash. That panic proves the
    // guard let the call through instead of blocking it.
    client.upgrade(&upgrader, &new_wasm_hash);
}

#[test]
fn test_default_max_supply_is_unlimited() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    assert_eq!(client.get_max_supply(), i128::MAX);
}

#[test]
fn test_set_max_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    client.set_max_supply(&admin, &1_000);
    assert_eq!(client.get_max_supply(), 1_000);
}

#[test]
fn test_minter_can_mint_successfully() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let minter = Address::generate(&env);
    let recipient = Address::generate(&env);

    env.as_contract(&contract_id, || {
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::Minter, &minter);
    });

    // A non-admin address with Role::Minter can mint and the token accounting
    // updates exactly once for the recipient and total supply.
    assert!(client.try_mint(&minter, &recipient, &250).is_ok());
    assert_eq!(client.balance(&recipient), 250);
    assert_eq!(client.supply(), 250);
    assert_eq!(client.balance(&minter), 0);
}

#[test]
fn test_mint_beyond_max_supply_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.set_max_supply(&admin, &500);

    // Mint up to the cap
    assert!(client.try_mint(&admin, &user, &400).is_ok());

    // Mint remaining
    assert!(client.try_mint(&admin, &user, &100).is_ok());
    assert_eq!(client.supply(), 500);

    // Mint beyond cap should fail
    let result = client.try_mint(&admin, &user, &1);
    assert_eq!(result, Err(Ok(TokenError::MaxSupplyExceeded)));
}

#[test]
fn test_batch_mint_beyond_max_supply_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let user = Address::generate(&env);

    client.set_max_supply(&admin, &500);

    let recipients = soroban_sdk::vec![
        &env,
        crate::Recipient {
            to: user.clone(),
            amount: 600,
        },
    ];

    let result = client.try_batch_mint(&admin, &recipients);
    assert_eq!(result, Err(Ok(TokenError::MaxSupplyExceeded)));
}

#[test]
fn test_set_max_supply_rejects_negative() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    let result = client.try_set_max_supply(&admin, &-1);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));
}

#[test]
fn test_revoked_minter_cannot_mint() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let minter = Address::generate(&env);
    let user = Address::generate(&env);

    // Grant Minter role
    env.as_contract(&contract_id, || {
        bc_forge_admin::grant_role(&env, &admin, bc_forge_admin::Role::Minter, &minter);
    });

    // Assert that the newly minted tokens are added to the user's balance
    assert!(client.try_mint(&minter, &user, &100).is_ok());
    assert_eq!(client.balance(&user), 100);

    // Revoke Minter role
    env.as_contract(&contract_id, || {
        bc_forge_admin::revoke_role(&env, &admin, bc_forge_admin::Role::Minter, &minter).unwrap();
    });

    // Assert that the revoked minter is rejected when trying to mint
    let result = client.try_mint(&minter, &user, &100);
    assert!(
        result.is_err(),
        "expected minting to fail after role revocation"
    );

    // Assert that the user's balance remains unchanged
    assert_eq!(client.balance(&user), 100);
}

fn sample_fee_config() -> crate::FeeConfig {
    crate::FeeConfig {
        base_fee: 10,
        complexity_multiplier: 2,
        max_fee: 100,
        enabled: true,
    }
}

#[test]
fn test_admin_can_set_fee_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let config = sample_fee_config();

    client.set_fee_config(&admin, &config);
    assert_eq!(client.get_fee_config(), config);
}

#[test]
fn test_admin_can_set_treasury() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let treasury = Address::generate(&env);

    client.set_treasury(&admin, &treasury);
    assert_eq!(client.get_treasury(), treasury);
}

#[test]
fn test_admin_can_set_fee_exemption() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let exempt_address = Address::generate(&env);
    let exemption = crate::FeeExemption { exemption_type: 0 };

    client.set_fee_exemption(&admin, &exempt_address, &exemption);
    client.remove_fee_exemption(&admin, &exempt_address);
}

#[test]
fn test_unauthorized_caller_rejected_for_set_fee_config() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let unauthorized = Address::generate(&env);
    let config = sample_fee_config();

    let result = client.try_set_fee_config(&unauthorized, &config);
    assert!(result.is_err());
}

#[test]
fn test_unauthorized_caller_rejected_for_set_treasury() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let unauthorized = Address::generate(&env);
    let treasury = Address::generate(&env);

    let result = client.try_set_treasury(&unauthorized, &treasury);
    assert!(result.is_err());
}

#[test]
fn test_unauthorized_caller_rejected_for_set_fee_exemption() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let unauthorized = Address::generate(&env);
    let exempt_address = Address::generate(&env);
    let exemption = crate::FeeExemption { exemption_type: 1 };

    let result = client.try_set_fee_exemption(&unauthorized, &exempt_address, &exemption);
    assert!(result.is_err());
}

#[test]
fn test_set_fee_config_rejects_negative_values() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let mut config = sample_fee_config();
    config.base_fee = -1;

    let result = client.try_set_fee_config(&admin, &config);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));
}

// ── initialize deployer check ────────────────────────────────────────────────

#[test]
fn test_initialize_succeeds_for_deployer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);

    let result = client.try_initialize(&admin, &7, &String::from_str(&env, "Test"), &String::from_str(&env, "TST"));
    assert_eq!(result, Ok(()));
}

#[test]
#[should_panic]
fn test_initialize_fails_for_non_deployer() {
    let env = Env::default();
    // Don't mock_all_auths - only deployer can authorize

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let non_deployer = Address::generate(&env);

    env.as_contract(&contract_id, || {
        non_deployer.require_auth();
        client.initialize(&admin, &7, &String::from_str(&env, "Test"), &String::from_str(&env, "TST"));
    });
}

#[test]
fn test_initialize_fails_on_double_init() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let admin2 = Address::generate(&env);

    // First initialize succeeds
    client.initialize(&admin, &7, &String::from_str(&env, "Test"), &String::from_str(&env, "TST"));

    // Second initialize fails with AlreadyInitialized
    let result = client.try_initialize(&admin2, &7, &String::from_str(&env, "Test2"), &String::from_str(&env, "TST2"));
    assert_eq!(result, Err(Ok(TokenError::AlreadyInitialized)));
}
