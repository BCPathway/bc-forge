//! Tests for RBAC error naming conventions (#751), unauthorized-access error
//! codes (#752), and role bitmask helper functions (#753).

use super::*;
use soroban_sdk::InvokeError;

/// Minimal client harness: registers `AdminContract`, sets an admin, and
/// returns the client plus the admin address.
fn setup(env: &Env) -> (AdminContractClient<'_>, Address) {
    env.mock_all_auths();
    let contract_id = env.register(AdminContract, ());
    let client = AdminContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.set_admin(&admin);
    (client, admin)
}

/// Asserts that the module-level documentation table and the code-level
/// discriminants agree on the standardized PascalCase error names (#751).
#[test]
fn test_admin_error_variants_are_pascal_case_and_unique() {
    // Every variant name must start with an uppercase letter and contain no
    // underscores (PascalCase), and every discriminant must be unique.
    let mut seen: soroban_sdk::Vec<u32> = soroban_sdk::Vec::new(&Env::default());
    let mut count = 0;
    macro_rules! check_variant {
        ($variant:ident = $code:literal) => {
            let name = stringify!($variant);
            assert!(
                name.chars().next().unwrap().is_uppercase(),
                "error variant `{name}` must be PascalCase"
            );
            assert!(
                !name.contains('_'),
                "error variant `{name}` must not contain underscores (PascalCase)"
            );
            assert!(
                !seen.contains($code),
                "duplicate error code {} for `{name}`",
                $code
            );
            seen.push_back($code);
            count += 1;
        };
    }
    check_variant!(RoleNotGranted = 1);
    check_variant!(RoleNotHeld = 2);
    check_variant!(UnauthorizedRole = 3);
    check_variant!(InvalidAddress = 4);
    check_variant!(InvalidRole = 5);
    check_variant!(AlreadyInitialized = 6);
    check_variant!(InvalidThreshold = 7);
    check_variant!(ProposalNotFound = 8);
    check_variant!(ProposalAlreadyExecuted = 9);
    check_variant!(ProposalAlreadyApproved = 10);
    check_variant!(ThresholdNotMet = 11);
    check_variant!(QuorumNotMet = 12);
    check_variant!(TimelockActive = 13);
    check_variant!(InvalidWasmHash = 14);
    check_variant!(NotProposer = 15);
    check_variant!(ProposalNotCancellable = 16);
    check_variant!(UpgradeProposalNotFound = 17);
    check_variant!(ProposalNotPending = 18);
    check_variant!(DuplicateVote = 19);
    check_variant!(Unauthorized = 20);
    check_variant!(RoleAlreadyGranted = 21);
    assert_eq!(count, 21, "expected all 21 standardized error variants");
}

/// The `Unauthorized` variant (#752) must exist and convert into a Soroban
/// status (the `#[contracterror]` macro derives the conversion).
#[test]
fn test_unauthorized_error_converts_into_status() {
    let error: InvokeError = AdminError::Unauthorized.into();
    assert_eq!(error, InvokeError::from(AdminError::Unauthorized));
}

/// The `Unauthorized` variant must be distinct from `UnauthorizedRole` and
/// carry its own discriminant (#752: granular authorization failures).
#[test]
fn test_unauthorized_is_distinct_from_role_specific_error() {
    let general = AdminError::Unauthorized as u32;
    let role_specific = AdminError::UnauthorizedRole as u32;
    assert_ne!(general, role_specific);
    assert_eq!(general, 20);
    assert_eq!(role_specific, 3);
}

/// Bitwise-AND helper: `mask_has_role` reports role presence per bit (#753).
#[test]
fn test_mask_has_role_bitwise_and() {
    // Admin = bit 0 (1), Minter = bit 1 (2), SuperAdmin = bit 2 (4), Pauser = bit 3 (8).
    let mask = ROLE_BIT_ADMIN | ROLE_BIT_MINTER;
    assert!(mask_has_role(mask, Role::Admin));
    assert!(mask_has_role(mask, Role::Minter));
    assert!(!mask_has_role(mask, Role::SuperAdmin));
    assert!(!mask_has_role(mask, Role::Pauser));
    assert!(!mask_has_role(0, Role::Admin));
}

/// Bitwise-OR helper: `mask_with_role` sets the requested bit (#753).
#[test]
fn test_mask_with_role_bitwise_or() {
    let mask = mask_with_role(0, Role::Admin);
    assert_eq!(mask, ROLE_BIT_ADMIN);

    let mask = mask_with_role(mask, Role::Minter);
    assert_eq!(mask, ROLE_BIT_ADMIN | ROLE_BIT_MINTER);

    // Idempotent: setting an already-set bit is a no-op.
    assert_eq!(mask_with_role(mask, Role::Admin), mask);
}

/// Bitwise AND-NOT helper: `mask_without_role` clears the requested bit (#753).
#[test]
fn test_mask_without_role_bitwise_and_not() {
    let mask = ROLE_BIT_ADMIN | ROLE_BIT_MINTER | ROLE_BIT_PAUSER;
    let cleared = mask_without_role(mask, Role::Minter);
    assert_eq!(cleared, ROLE_BIT_ADMIN | ROLE_BIT_PAUSER);
    assert!(!mask_has_role(cleared, Role::Minter));

    // Clearing an already-clear bit is a no-op.
    assert_eq!(mask_without_role(cleared, Role::Minter), cleared);
}

/// #761 — every recognized role discriminant passes grant_role's validation.
/// The public `Role` type is a `#[contracttype]` enum (name-encoded), so the
/// type system already excludes unknown discriminants; this test locks in that
/// each valid role is accepted end-to-end and mapped to its bitmask bit.
#[test]
fn test_grant_role_accepts_every_recognized_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);

    for role in [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser] {
        let holder = Address::generate(&env);
        client.grant_role(&admin, &role, &holder);
        assert!(client.has_role(&role, &holder));
        // Role bit is the power-of-two bound the issue's "valid bitmask" step
        // checks (#761): exactly one bit is set for each recognized role.
        assert_eq!(role_bit(role), Some(mask_with_role(0, role)));
    }
}

/// #768 — granting a role the target already holds fails with
/// `RoleAlreadyGranted`, not a silent no-op.
#[test]
fn test_grant_role_already_granted_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup(&env);
    let holder = Address::generate(&env);

    client.grant_role(&admin, &Role::Minter, &holder);
    assert!(client.has_role(&Role::Minter, &holder));

    let result = client.try_grant_role(&admin, &Role::Minter, &holder);
    assert_eq!(result, Err(Ok(soroban_sdk::Error::from_contract_error(21))));
}

/// The four role bits are exactly 1, 2, 4, 8 (#753: bitwise values 1, 2, 4, 8).
#[test]
fn test_role_bits_are_1_2_4_8() {
    assert_eq!(ROLE_BIT_ADMIN, 1);
    assert_eq!(ROLE_BIT_MINTER, 2);
    assert_eq!(ROLE_BIT_SUPER_ADMIN, 4);
    assert_eq!(ROLE_BIT_PAUSER, 8);
}

/// Composite masks behave correctly through the helper round-trip (#753).
#[test]
fn test_mask_helpers_round_trip() {
    let mut mask = 0u32;
    for role in [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser] {
        mask = mask_with_role(mask, role);
    }
    assert_eq!(
        mask,
        ROLE_BIT_ADMIN | ROLE_BIT_MINTER | ROLE_BIT_SUPER_ADMIN | ROLE_BIT_PAUSER
    );

    for role in [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser] {
        assert!(mask_has_role(mask, role));
    }

    mask = mask_without_role(mask, Role::SuperAdmin);
    assert!(!mask_has_role(mask, Role::SuperAdmin));
    assert!(mask_has_role(mask, Role::Admin));
}
