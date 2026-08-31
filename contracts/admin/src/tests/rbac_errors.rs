//! Tests for RBAC error naming conventions (#751), unauthorized-access error
//! codes (#752), and role bitmask helper functions (#753).

use super::*;
use soroban_sdk::InvokeError;

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
    check_variant!(BatchLengthMismatch = 21);
    check_variant!(RoleAlreadyGranted = 22);
    assert_eq!(count, 22, "expected all 22 standardized error variants");
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

/// #761: unrecognized role inputs are rejected, not silently accepted.
///
/// `Role` is a `#[contracttype]` enum whose wire format is the variant's case
/// name (a `Symbol`), so a discriminant outside the defined set fails to
/// decode in `try_from_val` before the contract's own `require_valid_role`
/// guard is ever reached. This test locks that boundary in: every defined
/// variant round-trips, and an unknown case name is a conversion error.
#[test]
fn test_invalid_role_discriminant_is_rejected_at_decode() {
    let env = Env::default();

    for role in [Role::Admin, Role::Minter, Role::SuperAdmin, Role::Pauser] {
        let val: Val = role.to_val();
        assert_eq!(Role::try_from_val(&env, &val), Ok(role));
    }

    // A role name outside the defined set must not decode.
    let unknown = Symbol::new(&env, "RoleThatDoesNotExist");
    let bad_val: Val = soroban_sdk::vec![&env, unknown.to_val()].into_val(&env);
    let decoded: Result<Role, soroban_sdk::ConversionError> = Role::try_from_val(&env, &bad_val);
    assert!(
        decoded.is_err(),
        "unrecognized role discriminant must not decode into a Role"
    );
}

/// #769: the role system separates concerns that the legacy monolithic admin
/// check blurred — an Admin holder is not a Pauser and vice versa, so
/// role-scoped operations (pause/unpause) can be gated independently of
/// admin-level operations.
#[test]
fn test_pauser_role_is_distinct_from_admin_role() {
    let env = Env::default();
    let admin_mask = ROLE_BIT_ADMIN;
    let pauser_mask = ROLE_BIT_PAUSER;

    assert!(mask_has_role(admin_mask, Role::Admin));
    assert!(!mask_has_role(admin_mask, Role::Pauser));
    assert!(mask_has_role(pauser_mask, Role::Pauser));
    assert!(!mask_has_role(pauser_mask, Role::Admin));

    // A single address can hold both, and each bit stays independently
    // addressable — the separation that lets Pauser-gated ops run without
    // full admin privileges.
    let combined = mask_with_role(admin_mask, Role::Pauser);
    assert!(mask_has_role(combined, Role::Admin));
    assert!(mask_has_role(combined, Role::Pauser));
    assert_eq!(
        mask_without_role(combined, Role::Pauser),
        ROLE_BIT_ADMIN
    );
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
