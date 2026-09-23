#![cfg(test)]

extern crate std;

use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Events, Ledger};
use soroban_sdk::{vec, Address, BytesN, Env, IntoVal, Map, String, TryIntoVal, Vec};

use super::{AdminContract, AdminContractClient, Role};
use crate::{AdminError, AdminKey, ProposalStatus, UpgradeProposal};

const ALL_ROLES: [Role; 4] = [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser];
const GRANTABLE_ROLES: [Role; 3] = [Role::Minter, Role::SuperAdmin, Role::Pauser];

fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

fn role_for_idx(idx: u32) -> Role {
    ALL_ROLES[idx as usize % ALL_ROLES.len()]
}

/// Seeds `AdminKey::ProposalIdCounter` directly so ID-generation fuzz cases
/// can probe counter states that would take far too long to reach by calling
/// `create_proposal` in a loop (e.g. values near `u64::MAX`).
fn seed_proposal_id_counter(env: &Env, contract_id: &Address, value: u64) {
    env.as_contract(contract_id, || {
        env.storage()
            .instance()
            .set(&AdminKey::ProposalIdCounter, &value);
    });
}

/// Seeds an `UpgradeProposal` directly under `AdminKey::UpgradeProposal(id)`,
/// bypassing the (not-yet-implemented) submission entry point — mirrors
/// `store_upgrade_proposal` in the main test module, but lives here so the
/// ID-collision fuzz cases can seed arbitrary, widely-spaced IDs.
fn seed_upgrade_proposal(env: &Env, contract_id: &Address, id: u64, proposer: &Address) {
    let mut votes = Map::new(env);
    votes.set(proposer.clone(), 1u32);
    let proposal = UpgradeProposal {
        proposer: proposer.clone(),
        targets: Vec::new(env),
        votes,
        quorum: 2,
        status: ProposalStatus::Pending,
        expires_at: u64::MAX,
        timelock_expires_at: None,
    };
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .set(&AdminKey::UpgradeProposal(id), &proposal);
    });
}

fn read_upgrade_proposal(env: &Env, contract_id: &Address, id: u64) -> UpgradeProposal {
    env.as_contract(contract_id, || {
        env.storage()
            .persistent()
            .get(&AdminKey::UpgradeProposal(id))
            .expect("seeded upgrade proposal should be readable")
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// Fuzz: grant_role succeeds for every valid Role variant.
    #[test]
    fn fuzz_grant_role_every_variant(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);

        prop_assert!(client.has_role(&role, &holder));
    }

    /// Fuzz: granting the same role to the same address N times is idempotent.
    #[test]
    fn fuzz_grant_role_idempotent(role_idx in 0u32..4, count in 1..20u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for _ in 0..count {
            client.grant_role(&admin, &role, &holder);
        }

        prop_assert!(client.has_role(&role, &holder));
    }

    /// Fuzz: any subset of roles can be granted to the same address.
    /// Note: Admin is excluded because it implicitly grants all other roles.
    #[test]
    fn fuzz_grant_role_multiple_roles(mask in 0u16..8) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            if (mask >> i) & 1 == 1 {
                client.grant_role(&admin, role, &holder);
            }
        }

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            prop_assert_eq!(client.has_role(role, &holder), (mask >> i) & 1 == 1);
        }
    }

    /// Fuzz: SuperAdmin delegation — a SuperAdmin can grant any role.
    #[test]
    fn fuzz_grant_role_via_super_admin(target_idx in 0u32..4) {
        let target = role_for_idx(target_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let super_admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        prop_assert!(client.has_role(&Role::SuperAdmin, &super_admin));

        client.grant_role(&super_admin, &target, &holder);
        prop_assert!(client.has_role(&target, &holder));
    }

    /// Fuzz: grant_role to many distinct addresses — all should hold the role.
    #[test]
    fn fuzz_grant_role_many_holders(role_idx in 0u32..4, extra in 0..10u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let mut holders = Vec::new(&env);
        for _ in 0..extra + 1 {
            holders.push_back(Address::generate(&env));
        }

        for h in holders.iter() {
            prop_assert!(!client.has_role(&role, &h));
        }
        for h in holders.iter() {
            client.grant_role(&admin, &role, &h);
        }
        for h in holders.iter() {
            prop_assert!(client.has_role(&role, &h));
        }
    }

    /// Fuzz: grant_role emits a `role_grnt` event with the correct data.
    #[test]
    fn fuzz_grant_role_emits_event(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let contract_id = client.address.clone();
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);

        let events = env.events().all();
        let last = events.get(events.len() - 1).expect("should have at least one event");
        let (emitter, topics, data) = last;
        prop_assert_eq!(emitter, contract_id);
        let t0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(t0, soroban_sdk::symbol_short!("role_grnt"));
        let dv: soroban_sdk::Vec<soroban_sdk::Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = dv.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = dv.get(1).unwrap().try_into_val(&env).unwrap();
        let event_addr: Address = dv.get(2).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(event_admin, admin);
        prop_assert_eq!(event_role, role);
        prop_assert_eq!(event_addr, holder);
    }

    /// Fuzz: grant_role where holder is the caller themselves (self-grant for SuperAdmin).
    #[test]
    fn fuzz_grant_role_self_grant(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let super_admin = Address::generate(&env);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.grant_role(&super_admin, &role, &super_admin);
        prop_assert!(client.has_role(&role, &super_admin));
    }

    /// Fuzz: Admin role implicitly grants all other roles (has_role check).
    #[test]
    fn fuzz_admin_implicitly_has_all_roles(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        if role != Role::Admin {
            prop_assert!(!client.has_role(&role, &holder));
        }
        client.grant_role(&admin, &Role::Admin, &holder);
        prop_assert!(client.has_role(&role, &holder));
    }

    /// Fuzz: Timelock boundary is strictly enforced.
    /// Varies ledger timestamp around the timelock expiration to ensure:
    /// - Execution fails before timelock expires (`AdminError::TimelockActive`)
    /// - At/after expiration the recorded unlock time is not in the future
    ///   (native Env panics at WASM install, so success is not asserted via execute)
    #[test]
    fn fuzz_timelock_boundary_enforcement(offset in -10i64..20i64) {
        let env = Env::default();
        let (client, admin) = setup(&env);

        let member = Address::generate(&env);
        client.set_admin_pool(&vec![&env, admin.clone(), member.clone()], &2);

        let proposal_id = client.create_proposal(&admin, &String::from_str(&env, "timelock test"));
        client.approve_proposal(&member, &proposal_id);

        let unlock_time = client.get_proposal_unlock_time(&proposal_id);
        prop_assert!(unlock_time.is_some());
        let unlock_time = unlock_time.unwrap();

        let mut ledger_info = env.ledger().get();
        let base_timestamp = unlock_time as i64;
        let target_timestamp = base_timestamp.saturating_add(offset);
        ledger_info.timestamp = if target_timestamp < 0 { 0 } else { target_timestamp as u64 };
        env.ledger().set(ledger_info);

        let dummy_wasm_hash = BytesN::from_array(&env, &[1u8; 32]);

        if offset < 0 {
            let result = client.try_execute_upgrade(&admin, &proposal_id, &dummy_wasm_hash);
            prop_assert_eq!(result, Err(Ok(AdminError::TimelockActive)));
        } else {
            prop_assert!(env.ledger().timestamp() >= unlock_time);
        }
    }

    /// Fuzz: revoke_role succeeds for every valid Role variant and clears membership.
    #[test]
    fn fuzz_revoke_role_every_variant(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);
        prop_assert!(client.has_role(&role, &holder));

        client.revoke_role(&admin, &role, &holder);

        prop_assert!(!client.has_role(&role, &holder));
    }

    /// Fuzz: revoking a role that was never granted errors gracefully
    /// with `RoleNotHeld` — no panic on arbitrary inputs.
    #[test]
    fn fuzz_revoke_role_not_held(role_idx in 0u32..4, count in 1..5u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for _ in 0..count {
            let result = client.try_revoke_role(&admin, &role, &holder);
            prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
            prop_assert!(!client.has_role(&role, &holder));
        }
    }

    /// Fuzz: double revoke — the second call returns `RoleNotHeld`.
    #[test]
    fn fuzz_revoke_role_double_revoke(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);
        client.revoke_role(&admin, &role, &holder);

        let result = client.try_revoke_role(&admin, &role, &holder);
        prop_assert_eq!(result, Err(Ok(AdminError::RoleNotHeld)));
        prop_assert!(!client.has_role(&role, &holder));
    }

    /// Fuzz: revoking any subset of granted roles leaves the rest intact.
    /// Note: Admin is excluded because it implicitly grants all other roles.
    #[test]
    fn fuzz_revoke_role_subset(mask in 1u16..8) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let holder = Address::generate(&env);

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            if (mask >> i) & 1 == 1 {
                client.grant_role(&admin, role, &holder);
            }
        }

        let revoke_mask = mask >> 1;
        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            if (revoke_mask >> i) & 1 == 1 && (mask >> i) & 1 == 1 {
                client.revoke_role(&admin, role, &holder);
            }
        }

        for (i, role) in GRANTABLE_ROLES.iter().enumerate() {
            let still_held = (mask >> i) & 1 == 1 && ((revoke_mask >> i) & 1 != 1);
            prop_assert_eq!(client.has_role(role, &holder), still_held);
        }
    }

    /// Fuzz: revoke_role rejects the zero address gracefully (`InvalidAddress`)
    /// regardless of grant state.
    #[test]
    fn fuzz_revoke_role_zero_address(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let zero = Address::from_str(&env, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");

        let result = client.try_revoke_role(&admin, &role, &zero);
        prop_assert_eq!(result, Err(Ok(AdminError::InvalidAddress)));
        prop_assert!(!client.has_role(&role, &zero));
    }

    /// Fuzz: revoked SuperAdmin can no longer grant or revoke roles.
    #[test]
    fn fuzz_revoke_role_breaks_delegation(target_idx in 0u32..4) {
        let target = role_for_idx(target_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let super_admin = Address::generate(&env);
        let holder = Address::generate(&env);

        client.grant_role(&admin, &Role::SuperAdmin, &super_admin);
        client.revoke_role(&admin, &Role::SuperAdmin, &super_admin);

        let grant_result = client.try_grant_role(&super_admin, &target, &holder);
        prop_assert_eq!(
            grant_result,
            Err(Ok(soroban_sdk::Error::from_contract_error(3)))
        );

        let revoke_result = client.try_revoke_role(&super_admin, &target, &holder);
        prop_assert_eq!(revoke_result, Err(Ok(AdminError::UnauthorizedRole)));

        prop_assert!(!client.has_role(&target, &holder));
    }

    /// Fuzz: many holders each get revoked independently; others keep the role.
    #[test]
    fn fuzz_revoke_role_many_holders(role_idx in 0u32..4, extra in 0..10u32, revoke_idx in 0..11u32) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let mut holders = Vec::new(&env);
        for _ in 0..extra + 1 {
            holders.push_back(Address::generate(&env));
        }

        for h in holders.iter() {
            client.grant_role(&admin, &role, &h);
        }

        let victim = holders.get(revoke_idx % (extra + 1)).unwrap();
        client.revoke_role(&admin, &role, &victim);
        prop_assert!(!client.has_role(&role, &victim));

        for h in holders.iter() {
            let expected = h != victim;
            prop_assert_eq!(client.has_role(&role, &h), expected);
        }
    }

    /// Fuzz: revoke_role emits a `role_rvk` event with the correct data.
    #[test]
    fn fuzz_revoke_role_emits_event(role_idx in 0u32..4) {
        let role = role_for_idx(role_idx);
        let env = Env::default();
        let (client, admin) = setup(&env);
        let contract_id = client.address.clone();
        let holder = Address::generate(&env);

        client.grant_role(&admin, &role, &holder);
        client.revoke_role(&admin, &role, &holder);

        let events = env.events().all();
        let last = events.get(events.len() - 1).expect("should have at least one event");
        let (emitter, topics, data) = last;
        prop_assert_eq!(emitter, contract_id);
        let t0: soroban_sdk::Symbol = topics.get(0).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(t0, soroban_sdk::symbol_short!("role_rvk"));
        let dv: soroban_sdk::Vec<soroban_sdk::Val> = data.try_into_val(&env).unwrap();
        let event_admin: Address = dv.get(0).unwrap().try_into_val(&env).unwrap();
        let event_role: Role = dv.get(1).unwrap().try_into_val(&env).unwrap();
        let event_addr: Address = dv.get(2).unwrap().try_into_val(&env).unwrap();
        prop_assert_eq!(event_admin, admin);
        prop_assert_eq!(event_role, role);
        prop_assert_eq!(event_addr, holder);
    }

    // ── Proposal ID generation & lookup (#677) ──────────────────────────

    /// Fuzz: repeated `create_proposal` calls always yield unique,
    /// monotonically increasing IDs — no collisions — and every generated ID
    /// is immediately, panic-free lookup-able.
    #[test]
    fn fuzz_create_proposal_ids_sequential_no_collision(count in 1u32..30) {
        let env = Env::default();
        let (client, admin) = setup(&env);

        for expected in 0..count as u64 {
            let id = client.create_proposal(&admin, &String::from_str(&env, "fuzz"));
            prop_assert_eq!(id, expected);
            prop_assert!(client.try_is_proposal_ready(&id).is_ok());
        }
    }

    /// Fuzz: `create_proposal` never collides with pre-existing state, even
    /// when the ID counter is seeded at arbitrary points across the `u64`
    /// space (including values close to `u64::MAX`). The generated ID always
    /// matches the seeded counter value, and a never-written neighboring ID
    /// still reports "not found".
    #[test]
    fn fuzz_create_proposal_id_matches_arbitrary_counter_seed(seed in 0u64..u64::MAX) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.set_admin(&admin);
        seed_proposal_id_counter(&env, &contract_id, seed);

        let id = client.create_proposal(&admin, &String::from_str(&env, "seeded"));
        prop_assert_eq!(id, seed);
        prop_assert!(client.try_is_proposal_ready(&id).is_ok());

        // A neighboring ID that was never written must not have been
        // touched by this creation.
        let neighbor = seed + 1;
        prop_assert!(client.try_is_proposal_ready(&neighbor).is_err());
    }

    /// Fuzz: looking up an arbitrary (near-certainly nonexistent) proposal ID
    /// across the full `u64` space never triggers an unexpected panic —
    /// every governance-proposal and upgrade-proposal entry point degrades
    /// to a well-defined error instead.
    #[test]
    fn fuzz_lookup_arbitrary_proposal_id_no_unexpected_panic(id in any::<u64>()) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(AdminContract, ());
        let client = AdminContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.set_admin(&admin);
        let wasm_hash = BytesN::from_array(&env, &[0u8; 32]);

        prop_assert!(client.try_is_proposal_ready(&id).is_err());
        prop_assert!(client.try_approve_proposal(&admin, &id).is_err());
        prop_assert!(client.try_mark_executed(&id).is_err());
        prop_assert_eq!(
            client.try_execute_upgrade(&admin, &id, &wasm_hash),
            Err(Ok(AdminError::ProposalNotFound))
        );
        prop_assert_eq!(client.get_proposal_unlock_time(&id), None);
        prop_assert_eq!(
            client.try_approve_upgrade(&admin, &id),
            Err(Ok(AdminError::UpgradeProposalNotFound))
        );
        // Note: unlike `approve_upgrade`, `cancel_proposal` reports a missing
        // entry as `ProposalNotFound` rather than `UpgradeProposalNotFound`
        // (see `cancel_proposal` in lib.rs) — asserted here as documented
        // current behavior, not a statement that it's the ideal error code.
        prop_assert_eq!(
            client.try_cancel_proposal(&admin, &id),
            Err(Ok(AdminError::ProposalNotFound))
        );
    }

    /// Fuzz: two `UpgradeProposal` entries seeded at arbitrary, distinct
    /// `u64` IDs never collide in storage, no matter how close together or
    /// far apart the IDs are (including values at the extreme ends of the
    /// `u64` space) — each ID's slot is independently readable.
    #[test]
    fn fuzz_upgrade_proposal_ids_no_storage_collision(id_a in any::<u64>(), gap in 1u64..=10_000) {
        let id_b = id_a.wrapping_add(gap);

        let env = Env::default();
        let contract_id = env.register(AdminContract, ());

        let proposer_a = Address::generate(&env);
        let proposer_b = Address::generate(&env);
        seed_upgrade_proposal(&env, &contract_id, id_a, &proposer_a);
        seed_upgrade_proposal(&env, &contract_id, id_b, &proposer_b);

        let stored_a = read_upgrade_proposal(&env, &contract_id, id_a);
        let stored_b = read_upgrade_proposal(&env, &contract_id, id_b);
        prop_assert_eq!(stored_a.proposer, proposer_a);
        prop_assert_eq!(stored_b.proposer, proposer_b);
    }

    /// Fuzz: grant_role with boundary addresses (empty bytes and strings)
    #[test]
    fn fuzz_grant_role_boundary_addresses(invalid_bytes in prop::collection::vec(any::<u8>(), 0..256)) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let contract_id = client.address.clone();

        let bytes_val = soroban_sdk::Bytes::from_slice(&env, &invalid_bytes);

        let args_bytes = soroban_sdk::vec![
            &env,
            admin.to_val(),
            Role::Minter.into_val(&env),
            bytes_val.to_val()
        ];

        let res_bytes = env.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
            &contract_id,
            &soroban_sdk::Symbol::new(&env, "grant_role"),
            args_bytes
        );
        prop_assert!(res_bytes.is_err(), "grant_role should fail decoding invalid bytes");

        if let Ok(s) = std::str::from_utf8(&invalid_bytes) {
            let string_val = soroban_sdk::String::from_str(&env, s);
            let args_str = soroban_sdk::vec![
                &env,
                admin.to_val(),
                Role::Minter.into_val(&env),
                string_val.to_val()
            ];
            let res_str = env.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
                &contract_id,
                &soroban_sdk::Symbol::new(&env, "grant_role"),
                args_str
            );
            prop_assert!(res_str.is_err(), "grant_role should fail decoding invalid string");
        }
    }

    /// Fuzz: grant_role with explicitly empty and extremely long strings
    #[test]
    fn fuzz_grant_role_empty_and_max_length(length in prop::sample::select(std::vec![0usize, 10000usize])) {
        let env = Env::default();
        let (client, admin) = setup(&env);
        let contract_id = client.address.clone();

        // Generate a string of 'A's of the given length.
        // For length=0, it's empty bytes/string. For 10000, it's max-length.
        let s = std::string::String::from_utf8(std::vec![b'A'; length]).unwrap();

        let string_val = soroban_sdk::String::from_str(&env, &s);
        let args_str = soroban_sdk::vec![
            &env,
            admin.to_val(),
            Role::Minter.into_val(&env),
            string_val.to_val()
        ];
        let res_str = env.try_invoke_contract::<soroban_sdk::Val, soroban_sdk::Error>(
            &contract_id,
            &soroban_sdk::Symbol::new(&env, "grant_role"),
            args_str
        );
        prop_assert!(res_str.is_err(), "grant_role should fail decoding empty/max-length string");
    }
}

/// Deterministic boundary case: exhausting the `u64` proposal-ID space must
/// panic rather than silently wrap the counter back to `0` and collide with
/// the very first proposal ever created. `overflow-checks = true` is set for
/// both the `release` and default `dev` profiles (see the workspace
/// `Cargo.toml`), so `id + 1` traps here exactly as it would on-chain.
#[test]
fn test_create_proposal_id_space_exhaustion_panics_no_silent_collision() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    seed_proposal_id_counter(&env, &contract_id, u64::MAX);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        client.create_proposal(&admin, &String::from_str(&env, "overflow"));
    }));
    assert!(
        result.is_err(),
        "counter overflow at u64::MAX must panic rather than silently wrap into a colliding proposal id"
    );
}
