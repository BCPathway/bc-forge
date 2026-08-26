//! Storage-collision tests for initialization.
//!
//! A `BcForgeToken` instance is written by four `#[contracttype]` key enums:
//! this crate's [`DataKey`], [`AdminKey`], [`LifecycleKey`] and the rate-limit
//! `DataKey`, plus one family that is not a `#[contracttype]` at all, the
//! `reentrancy_guard!` slots keyed by a bare `Symbol`. All five land in the
//! same contract storage, so these tests pin which slots `initialize` writes,
//! that a rejected re-initialization writes nothing at all, and exactly where
//! the five families do and do not share a slot.
//!
//! A few tests write past `initialize` on purpose: the layout it lays down is
//! only proved collision-free by the later writes that have to land beside it,
//! so `approve`, the rate-limit counters and a guarded `mint` are exercised
//! against the slots initialization created.

#![cfg(test)]

use crate::reentrancy_guard::ReentrancyGuardState;
use crate::{BcForgeToken, BcForgeTokenClient, DataKey, TokenError};
use bc_forge_admin::{AdminKey, Role};
use bc_forge_lifecycle::LifecycleKey;
use bc_forge_rate_limit::{BcForgeRateLimit, DataKey as RateLimitKey, RateLimitState};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec};

/// The encoded slot name of every [`DataKey`] variant, sorted.
///
/// Frozen on purpose: these literals do not derive from the enum, so renaming a
/// variant fails here instead of silently orphaning the slot every deployed
/// contract already wrote under.
const DATA_KEY_SLOT_NAMES: [&str; 14] = [
    "Admin",
    "Allowance",
    "AllowanceExp",
    "Balance",
    "Decimals",
    "FeeConfig",
    "FeeExemption",
    "Lockup",
    "MaxSupply",
    "Name",
    "PendingAdmin",
    "Supply",
    "Symbol",
    "Treasury",
];

fn setup(env: &Env) -> (BcForgeTokenClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &contract_id);

    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "bc-forge Token"),
        &String::from_str(env, "SFG"),
    );

    (client, admin)
}

/// Decodes the ledger key a `#[contracttype]` enum value addresses.
///
/// Such a key encodes as a vector whose first element is the variant name as a
/// symbol, followed by the variant's arguments.
fn slot_parts(env: &Env, key: impl IntoVal<Env, Val>) -> Vec<Val> {
    Vec::try_from_val(env, &key.into_val(env)).expect("key should encode as a vector")
}

fn slot_name(env: &Env, key: impl IntoVal<Env, Val>) -> Symbol {
    let parts = slot_parts(env, key);
    Symbol::try_from_val(env, &parts.get(0).expect("key name should exist"))
        .expect("key name should be a symbol")
}

/// Build guard, not a test: the match is exhaustive, so adding or removing a
/// [`DataKey`] variant stops this file compiling and forces the new slot name
/// to be checked against the other key enums writing into the same storage.
fn data_key_name(key: &DataKey) -> &'static str {
    match key {
        DataKey::Admin => "Admin",
        DataKey::PendingAdmin => "PendingAdmin",
        DataKey::Allowance(_, _) => "Allowance",
        DataKey::AllowanceExp(_, _) => "AllowanceExp",
        DataKey::Balance(_) => "Balance",
        DataKey::Lockup(_) => "Lockup",
        DataKey::Decimals => "Decimals",
        DataKey::Name => "Name",
        DataKey::Symbol => "Symbol",
        DataKey::Supply => "Supply",
        DataKey::MaxSupply => "MaxSupply",
        DataKey::Treasury => "Treasury",
        DataKey::FeeConfig => "FeeConfig",
        DataKey::FeeExemption(_) => "FeeExemption",
    }
}

fn all_data_keys(env: &Env) -> [DataKey; 14] {
    let owner = Address::generate(env);
    let spender = Address::generate(env);
    [
        DataKey::Admin,
        DataKey::PendingAdmin,
        DataKey::Allowance(owner.clone(), spender.clone()),
        DataKey::AllowanceExp(owner.clone(), spender),
        DataKey::Balance(owner.clone()),
        DataKey::Lockup(owner.clone()),
        DataKey::Decimals,
        DataKey::Name,
        DataKey::Symbol,
        DataKey::Supply,
        DataKey::MaxSupply,
        DataKey::Treasury,
        DataKey::FeeConfig,
        DataKey::FeeExemption(owner),
    ]
}

fn all_admin_keys(env: &Env) -> [AdminKey; 9] {
    let address = Address::generate(env);
    [
        AdminKey::Admin,
        AdminKey::Role(Role::Admin, address.clone()),
        AdminKey::AddressRole(address.clone(), Role::Admin),
        AdminKey::AdminPool,
        AdminKey::Threshold,
        AdminKey::Proposal(1),
        AdminKey::ProposalIdCounter,
        AdminKey::SuperAdmin(address.clone()),
        AdminKey::RoleMask(address),
    ]
}

fn all_lifecycle_keys() -> [LifecycleKey; 1] {
    [LifecycleKey::Paused]
}

fn all_rate_limit_keys(env: &Env) -> [RateLimitKey; 6] {
    let address = Address::generate(env);
    let op = String::from_str(env, crate::rate_limit::OPERATION_MINT);
    [
        RateLimitKey::GlobalRateLimit(op.clone()),
        RateLimitKey::AddressRateLimit(address.clone(), op.clone()),
        RateLimitKey::GlobalLastReset(op.clone()),
        RateLimitKey::AddressLastReset(address.clone(), op.clone()),
        RateLimitKey::GlobalCount(op.clone()),
        RateLimitKey::AddressCount(address, op),
    ]
}

/// `initialize` writes five metadata slots plus the admin slot in instance
/// storage and one role entry in persistent storage, and touches nothing else.
#[test]
fn test_initialize_writes_only_its_documented_slots() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();

    env.as_contract(&contract_id, || {
        for key in all_data_keys(&env).iter() {
            let name = data_key_name(key);
            // Admin is set without `initialize` ever writing DataKey::Admin:
            // admin::set_admin writes AdminKey::Admin, which is the same slot.
            let written = matches!(
                name,
                "Admin" | "Decimals" | "Name" | "Symbol" | "Supply" | "MaxSupply"
            );
            assert_eq!(
                env.storage().instance().has(key),
                written,
                "wrong instance slot state after initialize for {name}"
            );
        }

        // The role grant is the only persistent write, and only because
        // `initialize` takes no reentrancy guard: every guarded entry point
        // writes a bare `Symbol` slot into this same namespace. Enumerating
        // every family below is what makes "only" a tested claim rather than
        // a spot check on the slots someone thought to name.
        let role = AdminKey::RoleMask(admin.clone());
        assert!(
            env.storage().persistent().has(&role),
            "set_admin should grant the Admin role in persistent storage"
        );
        assert!(
            !env.storage()
                .persistent()
                .has(&Symbol::new(&env, "mint_guard")),
            "initialize runs under no guard, so it writes no guard slot"
        );
        for key in all_data_keys(&env).iter() {
            let name = data_key_name(key);
            assert!(
                !env.storage().persistent().has(key),
                "initialize should write no persistent slot for {name}"
            );
        }
        for key in all_admin_keys(&env).iter() {
            if *key == role {
                continue;
            }
            assert!(
                !env.storage().persistent().has(key),
                "initialize should write no persistent admin slot"
            );
        }
        for key in all_lifecycle_keys().iter() {
            assert!(
                !env.storage().persistent().has(key),
                "initialize should write no persistent lifecycle slot"
            );
        }
        for key in all_rate_limit_keys(&env).iter() {
            assert!(
                !env.storage().persistent().has(key),
                "initialize should write no persistent rate-limit slot"
            );
        }
        // Instance and persistent are separate namespaces, so a key present in
        // one is absent in the other even though the encoded key is identical.
        assert!(
            !env.storage().instance().has(&role),
            "the role entry should not appear in instance storage"
        );

        assert!(
            !env.storage().instance().has(&LifecycleKey::Paused),
            "initialize leaves the lifecycle slot unset"
        );
        for key in all_rate_limit_keys(&env).iter() {
            assert!(
                !env.storage().instance().has(key),
                "initialize writes no rate-limit slot"
            );
        }
    });
}

/// A second `initialize` is rejected before any write happens, so no slot is
/// partially overwritten: the guard runs ahead of `set_admin`, the metadata
/// writes, `write_supply(0)` and `write_max_supply(i128::MAX)`.
#[test]
fn test_reinitialize_is_rejected_and_leaves_every_slot_intact() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let holder = Address::generate(&env);
    let stranger = Address::generate(&env);

    // Move supply and the cap off the values a second initialize would write.
    client.mint(&admin, &holder, &500);
    client.set_max_supply(&admin, &1_000_000);

    let result = client.try_initialize(
        &stranger,
        &18,
        &String::from_str(&env, "Stranger"),
        &String::from_str(&env, "STR"),
    );
    assert_eq!(result, Err(Ok(TokenError::AlreadyInitialized)));

    // Repeat the rejected call directly rather than through the client. A
    // failed invocation has its storage rolled back by the host, which would
    // hide a write made before the guard; calling the function in place keeps
    // whatever it wrote, so the assertions below see the real slot contents.
    let rejected = env.as_contract(&contract_id, || {
        BcForgeToken::initialize(
            env.clone(),
            stranger.clone(),
            18,
            String::from_str(&env, "Stranger"),
            String::from_str(&env, "STR"),
        )
    });
    assert_eq!(rejected, Err(TokenError::AlreadyInitialized));

    assert_eq!(
        client.admin(),
        admin,
        "the admin slot keeps its first value"
    );
    assert_eq!(client.decimals(), 7, "decimals were not overwritten");
    assert_eq!(client.name(), String::from_str(&env, "bc-forge Token"));
    assert_eq!(client.symbol(), String::from_str(&env, "SFG"));
    assert_eq!(
        client.supply(),
        500,
        "a rejected re-initialize must not reset supply to zero"
    );
    assert_eq!(
        client.get_max_supply(),
        1_000_000,
        "a rejected re-initialize must not reset the supply cap"
    );
    assert_eq!(client.balance(&holder), 500);

    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&AdminKey::RoleMask(admin.clone())),
            "the original admin keeps its role"
        );
        assert!(
            !env.storage()
                .persistent()
                .has(&AdminKey::RoleMask(stranger.clone())),
            "the rejected caller must not be granted the Admin role"
        );
        let stored: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        assert_eq!(stored, Some(admin.clone()));
    });
}

/// The slot a variant addresses is its NAME, so the thirteen `DataKey` variants
/// occupy thirteen distinct slots and each one is fixed to the name a deployed
/// contract already stored under. Renaming a variant moves its slot and orphans
/// the data; the frozen list is what makes that a failure rather than a silent
/// migration.
#[test]
fn test_data_key_slot_names_match_the_frozen_set() {
    let env = Env::default();
    let keys = all_data_keys(&env);

    assert_eq!(
        keys.len(),
        DATA_KEY_SLOT_NAMES.len(),
        "a DataKey variant was added or removed"
    );

    for name in DATA_KEY_SLOT_NAMES {
        let expected = Symbol::new(&env, name);
        let addressed_by = keys
            .iter()
            .filter(|key| slot_name(&env, (*key).clone()) == expected)
            .count();
        assert_eq!(
            addressed_by, 1,
            "exactly one DataKey variant must address the frozen slot {name}"
        );
    }
}

/// `DataKey::Admin` and `AdminKey::Admin` are one slot: both are unit variants
/// named `Admin`, and the enum a variant was declared in is not part of the
/// encoded key. `initialize` never writes `DataKey::Admin` (it has no
/// production use at all), yet reading it returns the admin that
/// `admin::set_admin` stored under `AdminKey::Admin`.
#[test]
fn test_token_admin_key_and_admin_module_key_are_the_same_slot() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();

    assert_eq!(
        slot_name(&env, DataKey::Admin),
        slot_name(&env, AdminKey::Admin),
        "both variants address the Admin slot"
    );
    assert_eq!(slot_parts(&env, DataKey::Admin).len(), 1);
    assert_eq!(slot_parts(&env, AdminKey::Admin).len(), 1);

    env.as_contract(&contract_id, || {
        let via_token: Option<Address> = env.storage().instance().get(&DataKey::Admin);
        let via_module: Option<Address> = env.storage().instance().get(&AdminKey::Admin);
        assert_eq!(
            via_token,
            Some(admin.clone()),
            "the token key reads the address set through the admin module"
        );
        assert_eq!(via_token, via_module);
    });

    assert_eq!(client.admin(), admin);
}

/// The consequence of that shared slot: writing `DataKey::Admin` changes what
/// the admin module reports. Everything the admin module keys separately, such
/// as the persistent role entry, is unaffected.
#[test]
fn test_writing_the_token_admin_key_redirects_the_admin_module_lookup() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let stranger = Address::generate(&env);

    env.as_contract(&contract_id, || {
        env.storage().instance().set(&DataKey::Admin, &stranger);
    });

    assert_eq!(
        client.admin(),
        stranger,
        "admin::get_admin reads the slot the token key just wrote"
    );

    env.as_contract(&contract_id, || {
        assert!(
            env.storage()
                .persistent()
                .has(&AdminKey::RoleMask(admin.clone())),
            "the role entry sits in its own slot and survives"
        );
        assert!(
            !env.storage()
                .persistent()
                .has(&AdminKey::RoleMask(stranger.clone())),
            "overwriting the admin slot grants no role"
        );
    });
}

/// Across the key enums writing into a token instance, `Admin` is the one
/// shared slot. The two enums both named `DataKey` (this crate's and the
/// rate-limit crate's) share none, since the type name is not part of the key.
#[test]
fn test_admin_is_the_only_slot_shared_across_modules() {
    let env = Env::default();
    let contract_id = env.register(BcForgeToken, ());
    let data_keys = all_data_keys(&env);
    let admin_keys = all_admin_keys(&env);
    let lifecycle_keys = all_lifecycle_keys();
    let rate_limit_keys = all_rate_limit_keys(&env);

    env.as_contract(&contract_id, || {
        let instance = env.storage().instance();
        for (i, key) in data_keys.iter().enumerate() {
            instance.set(key, &(i as u32));
        }

        // Write every other module's key on top. Only a shared slot can change
        // a marker written above.
        let mut marker = data_keys.len() as u32;
        for key in admin_keys.iter() {
            instance.set(key, &marker);
            marker += 1;
        }
        for key in lifecycle_keys.iter() {
            instance.set(key, &marker);
            marker += 1;
        }
        for key in rate_limit_keys.iter() {
            instance.set(key, &marker);
            marker += 1;
        }

        let mut clobbered = 0;
        for (i, key) in data_keys.iter().enumerate() {
            let stored: Option<u32> = instance.get(key);
            if stored != Some(i as u32) {
                assert_eq!(
                    data_key_name(key),
                    "Admin",
                    "a new cross-module slot overlap appeared"
                );
                clobbered += 1;
            }
        }

        assert_eq!(
            clobbered, 1,
            "DataKey::Admin is the only slot another module writes"
        );
    });
}

/// Argument-addressing through the contract API: balances and allowances of
/// different addresses never share state, the reversed pair and the self-pair
/// are slots of their own, and an address that was never touched has no slot at
/// all.
#[test]
fn test_per_address_slots_stay_independent_through_the_client() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let owner = Address::generate(&env);
    let spender = Address::generate(&env);
    let untouched = Address::generate(&env);

    client.mint(&admin, &owner, &400);
    client.mint(&admin, &spender, &150);
    client.approve(&owner, &spender, &70, &u32::MAX);
    client.approve(&spender, &owner, &25, &u32::MAX);
    client.approve(&owner, &owner, &15, &u32::MAX);

    assert_eq!(client.balance(&owner), 400);
    assert_eq!(client.balance(&spender), 150);
    assert_eq!(client.balance(&untouched), 0);
    assert_eq!(client.allowance(&owner, &spender), 70);
    assert_eq!(
        client.allowance(&spender, &owner),
        25,
        "the reversed pair holds its own amount"
    );
    assert_eq!(
        client.allowance(&owner, &owner),
        15,
        "one address used for both arguments is a slot of its own"
    );
    assert_eq!(
        client.allowance(&owner, &untouched),
        0,
        "an allowance was never approved for this pair"
    );

    env.as_contract(&contract_id, || {
        assert!(
            !env.storage()
                .persistent()
                .has(&DataKey::Balance(untouched.clone())),
            "minting to other addresses creates no slot for this one"
        );
    });
}

/// Rate-limit counters share the instance namespace with the token metadata but
/// no slot with it. With no limit configured the mint path writes no counter at
/// all, so nothing lands in that namespace during or after initialization.
#[test]
fn test_rate_limit_counters_do_not_disturb_token_metadata() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let holder = Address::generate(&env);
    let op = String::from_str(&env, crate::rate_limit::OPERATION_MINT);

    client.mint(&admin, &holder, &100);

    env.as_contract(&contract_id, || {
        assert!(
            !env.storage()
                .instance()
                .has(&RateLimitKey::GlobalCount(op.clone())),
            "an unconfigured rate limit writes no counter"
        );
        BcForgeRateLimit::internal_set_global_rate_limit(&env, &op, 10, 3_600);
    });

    client.mint(&admin, &holder, &100);

    env.as_contract(&contract_id, || {
        let state: RateLimitState = env
            .storage()
            .instance()
            .get(&RateLimitKey::GlobalCount(op.clone()))
            .expect("mint counter should exist");
        assert_eq!(state.count, 1);
    });

    assert_eq!(client.decimals(), 7);
    assert_eq!(client.name(), String::from_str(&env, "bc-forge Token"));
    assert_eq!(client.symbol(), String::from_str(&env, "SFG"));
    assert_eq!(client.supply(), 200);
    assert_eq!(client.balance(&holder), 200);
    assert_eq!(client.admin(), admin);
    assert_eq!(client.get_max_supply(), i128::MAX);
}

/// The guard slots are the one key family that is not a `#[contracttype]` enum:
/// `reentrancy_guard!` keys persistent storage by a bare `Symbol`. A guarded
/// `mint` writes that slot and releases it, beside the role entry and the
/// balance in the same namespace and on top of neither.
#[test]
fn test_guard_slot_shares_persistent_storage_with_no_collision() {
    let env = Env::default();
    let (client, admin) = setup(&env);
    let contract_id = client.address.clone();
    let holder = Address::generate(&env);

    client.mint(&admin, &holder, &700);

    env.as_contract(&contract_id, || {
        let state: ReentrancyGuardState = env
            .storage()
            .persistent()
            .get(&Symbol::new(&env, "mint_guard"))
            .expect("mint guard slot should exist");
        assert_eq!(
            state,
            ReentrancyGuardState::NotEntered,
            "the guard is released once mint returns"
        );
        assert!(
            env.storage()
                .persistent()
                .has(&AdminKey::RoleMask(admin.clone())),
            "the guard write leaves the role entry in place"
        );
        let balance: Option<i128> = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(holder.clone()));
        assert_eq!(
            balance,
            Some(700),
            "the guard write leaves the balance slot alone"
        );
    });

    assert_eq!(client.supply(), 700);
}
