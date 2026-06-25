use crate::{BcForgeToken, BcForgeTokenClient, Recipient, TokenError};
use bc_forge_rate_limit::{DataKey as RateLimitDataKey, RateLimitConfig};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::testutils::Events as _;
use soroban_sdk::testutils::Ledger;
use soroban_sdk::{symbol_short, vec, Address, Env, String, TryIntoVal, Val, Vec};

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
fn test_mint_transfer_and_supply() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);
    let from = Address::generate(&env);
    let to = Address::generate(&env);

    client.mint(&from, &1_000);
    client.transfer(&from, &to, &300);

    assert_eq!(client.balance(&from), 700);
    assert_eq!(client.balance(&to), 300);
    assert_eq!(client.supply(), 1_000);
}

#[test]
fn test_initialize_emits_correct_event() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let name = String::from_str(&env, "Test Token");
    let symbol = String::from_str(&env, "TST");

    client.initialize(&admin, &7, &name, &symbol);

    let events = env.events().all();
    assert_eq!(
        events.len(),
        1,
        "expected exactly one event during initialization"
    );

    let (emitter, topics, data) = events.get(0).unwrap();

    // Event must be emitted by the token contract itself
    assert_eq!(emitter, contract_id);

    // Topics must contain (symbol_short!("init"), admin_address)
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

    // Data must be (decimal, name, symbol) as Vec<Val>
    // If admin were incorrectly in data, this would have 4 elements
    let data_vec: soroban_sdk::Vec<Val> = data.try_into_val(&env).unwrap();
    assert_eq!(
        data_vec.len(),
        3,
        "data should have 3 elements (decimal, name, symbol), confirming admin is in topics"
    );

    // Verify the decimal value matches
    let decimal: u32 = data_vec.get(0).unwrap().try_into_val(&env).unwrap();
    assert_eq!(decimal, 7);
}

// ─── Batch Minting Rate Limit Tests ─────────────────────────────────────────

#[test]
fn test_batch_mint_happy_path_multiple_recipients() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
        Recipient {
            to: carol.clone(),
            amount: 300,
        },
    ];

    client.batch_mint(&recipients);

    assert_eq!(client.balance(&alice), 100);
    assert_eq!(client.balance(&bob), 200);
    assert_eq!(client.balance(&carol), 300);
    assert_eq!(client.supply(), 600);
}

#[test]
fn test_batch_mint_single_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let to = Address::generate(&env);
    let recipients = vec![
        &env,
        Recipient {
            to: to.clone(),
            amount: 500,
        },
    ];

    client.batch_mint(&recipients);

    assert_eq!(client.balance(&to), 500);
    assert_eq!(client.supply(), 500);
}

#[test]
fn test_batch_mint_empty_recipients_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let recipients: Vec<Recipient> = vec![&env];
    client.batch_mint(&recipients);

    assert_eq!(client.supply(), 0);
}

#[test]
fn test_batch_mint_exceeds_global_rate_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_id) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    // Set global rate limit: at most 2 mint operations per window
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &RateLimitDataKey::GlobalRateLimit(String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 2,
                window_seconds: 3600,
            },
        );
    });

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    // First batch_mint within the limit should succeed
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    let result = client.try_batch_mint(&recipients);
    assert!(result.is_ok(), "first batch should succeed");

    // Second batch with 1 more recipient should fail (rate limit=2, already used 2)
    let recipients2 = vec![
        &env,
        Recipient {
            to: carol.clone(),
            amount: 300,
        },
    ];
    let result2 = client.try_batch_mint(&recipients2);
    assert_eq!(result2, Err(Ok(TokenError::InvalidAmount)));
}

#[test]
fn test_batch_mint_exactly_at_global_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_id) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    // Set global rate limit: exactly 3 mints per window
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &RateLimitDataKey::GlobalRateLimit(String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 3,
                window_seconds: 3600,
            },
        );
    });

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);

    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
        Recipient {
            to: carol.clone(),
            amount: 300,
        },
    ];

    let result = client.try_batch_mint(&recipients);
    assert!(result.is_ok(), "batch at exact limit should succeed");
    assert_eq!(client.supply(), 600);
}

#[test]
fn test_batch_mint_single_recipient_exceeds_global_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_id) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    // Set global rate limit: only 1 mint per window
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &RateLimitDataKey::GlobalRateLimit(String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 1,
                window_seconds: 3600,
            },
        );
    });

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // First single mint should succeed (count goes to 1)
    client.mint(&alice, &100);

    // A batch_mint with one recipient should now fail
    let recipients = vec![
        &env,
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));
}

#[test]
fn test_batch_mint_global_rate_limit_resets_after_window() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_id) = setup_contract(&env);
    let _admin = init_default(&env, &client);

    // Set global rate limit: 1 mint per 100-second window
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &RateLimitDataKey::GlobalRateLimit(String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 1,
                window_seconds: 100,
            },
        );
    });

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // First batch should succeed
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
    ];
    let result = client.try_batch_mint(&recipients);
    assert!(result.is_ok());

    // Second batch should fail (rate limit not yet reset)
    let recipients2 = vec![
        &env,
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    assert_eq!(
        client.try_batch_mint(&recipients2),
        Err(Ok(TokenError::InvalidAmount))
    );

    // Advance ledger timestamp past the window
    let mut ledger_info = env.ledger().get();
    ledger_info.timestamp += 200;
    env.ledger().set(ledger_info);

    // Now the rate limit should be reset
    let recipients3 = vec![
        &env,
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    let result3 = client.try_batch_mint(&recipients3);
    assert!(result3.is_ok());
    assert_eq!(client.balance(&bob), 200);
}

#[test]
fn test_batch_mint_exceeds_address_rate_limit() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_id) = setup_contract(&env);
    let admin = init_default(&env, &client);

    // Set a per-address rate limit for the admin: at most 1 mint per window
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &RateLimitDataKey::AddressRateLimit(admin.clone(), String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 1,
                window_seconds: 3600,
            },
        );
    });

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // First batch should succeed
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
    ];
    let result = client.try_batch_mint(&recipients);
    assert!(result.is_ok());

    // Second batch should fail (per-address limit exceeded)
    let recipients2 = vec![
        &env,
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    assert_eq!(
        client.try_batch_mint(&recipients2),
        Err(Ok(TokenError::InvalidAmount))
    );
}

#[test]
fn test_batch_mint_no_limit_set_always_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // With no rate limit configured, batch_mint should always succeed
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    client.batch_mint(&recipients);
    assert_eq!(client.supply(), 300);

    // Subsequent calls should also succeed
    let carol = Address::generate(&env);
    let recipients2 = vec![
        &env,
        Recipient {
            to: carol.clone(),
            amount: 300,
        },
    ];
    client.batch_mint(&recipients2);
    assert_eq!(client.supply(), 600);
}

#[test]
fn test_batch_mint_zero_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let to = Address::generate(&env);
    let recipients = vec![
        &env,
        Recipient {
            to: to.clone(),
            amount: 0,
        },
    ];

    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_batch_mint_negative_amount_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let to = Address::generate(&env);
    let recipients = vec![
        &env,
        Recipient {
            to: to.clone(),
            amount: -50,
        },
    ];

    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_batch_mint_mixed_valid_and_invalid_fails_at_first_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Second recipient has zero amount — batch should fail at the zero check
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: bob.clone(),
            amount: 0,
        },
    ];

    let result = client.try_batch_mint(&recipients);
    assert_eq!(result, Err(Ok(TokenError::InvalidAmount)));

    // All storage changes are rolled back when the function returns Err
    assert_eq!(client.balance(&alice), 0);
    assert_eq!(client.balance(&bob), 0);
    assert_eq!(client.supply(), 0);
}

#[test]
fn test_batch_mint_emits_mint_events_per_recipient() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];

    client.batch_mint(&recipients);

    let events = env.events().all();
    // Filter for mint events only
    let mut mint_count = 0u32;
    for i in 0..events.len() {
        let (_, topics, _) = events.get(i).unwrap();
        if topics.len() >= 1 {
            if let Ok(t0) = topics.get(0).unwrap().try_into_val(&env) {
                let sym: soroban_sdk::Symbol = t0;
                if sym == symbol_short!("mint") {
                    mint_count += 1;
                }
            }
        }
    }
    assert_eq!(mint_count, 2, "should have exactly 2 mint events");
}

#[test]
fn test_batch_mint_duplicate_recipients_both_receive_tokens() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let alice = Address::generate(&env);

    // Same address appears twice in the batch
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
        Recipient {
            to: alice.clone(),
            amount: 200,
        },
    ];

    client.batch_mint(&recipients);

    // Alice should receive the sum of both amounts
    assert_eq!(client.balance(&alice), 300);
    assert_eq!(client.supply(), 300);
}

#[test]
fn test_batch_mint_large_amounts() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup(&env);

    let to = Address::generate(&env);
    let large_amount: i128 = i128::MAX;

    let recipients = vec![
        &env,
        Recipient {
            to: to.clone(),
            amount: large_amount,
        },
    ];

    let result = client.try_batch_mint(&recipients);
    assert!(result.is_ok());
    assert_eq!(client.balance(&to), large_amount);
}

#[test]
fn test_batch_mint_global_and_address_limit_interaction() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, contract_id) = setup_contract(&env);
    let admin = init_default(&env, &client);

    // Global limit = 3, address limit for admin = 1
    env.as_contract(&contract_id, || {
        env.storage().instance().set(
            &RateLimitDataKey::GlobalRateLimit(String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 3,
                window_seconds: 3600,
            },
        );
        env.storage().instance().set(
            &RateLimitDataKey::AddressRateLimit(admin.clone(), String::from_str(&env, "mint")),
            &RateLimitConfig {
                limit: 1,
                window_seconds: 3600,
            },
        );
    });

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // First batch should hit the address limit first (limit=1)
    let recipients = vec![
        &env,
        Recipient {
            to: alice.clone(),
            amount: 100,
        },
    ];
    let result = client.try_batch_mint(&recipients);
    assert!(result.is_ok());

    // Second batch fails because address limit is exhausted
    let recipients2 = vec![
        &env,
        Recipient {
            to: bob.clone(),
            amount: 200,
        },
    ];
    assert_eq!(
        client.try_batch_mint(&recipients2),
        Err(Ok(TokenError::InvalidAmount))
    );
}
