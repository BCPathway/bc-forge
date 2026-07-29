use soroban_sdk::{contracttype, Address, String, Vec};

/// Storage keys for the access-control layer.
///
/// `#[contracttype]` derives a distinct ledger key for every variant (and,
/// for `Role(Role, Address)`, for every `(Role, Address)` pair), so entries
/// never collide with each other or with the other variants below.
#[derive(Clone)]
#[contracttype]
pub enum AdminKey {
    /// The singular contract admin address, set via `set_admin`.
    Admin,
    /// Maps a `(Role, Address)` pair to `true` when `address` holds `role`.
    /// This is the Role-to-Address mapping storage structure: membership is
    /// looked up directly by key rather than by scanning a list, and each
    /// pair occupies its own ledger entry so grants/revokes for one address
    /// never touch another's.
    Role(Role, Address),
    /// Multi-sig admin pool addresses, set via `set_admin_pool`.
    AdminPool,
    /// Multi-sig approval threshold, set alongside the pool.
    Threshold,
    /// Governance proposal data, keyed by proposal ID.
    Proposal(u64),
    /// Auto-incrementing counter for proposal IDs.
    ProposalIdCounter,
    /// Super-admin mapping populated by `migrate_admin` for legacy contracts.
    SuperAdmin(Address),
}

/// Roles recognized by the access-control layer.
///
/// New variants must be appended, never inserted, so that previously
/// persisted `AdminKey::Role(Role, Address)` entries keep decoding to the
/// same variant they were written with.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[contracttype]
pub enum Role {
    /// Full administrative control granted via `set_admin`.
    Admin,
    /// Permission to mint new tokens.
    Minter,
    /// Highest-privilege role, reserved for owner-level operations.
    SuperAdmin,
    /// Role allowing emergency pause and unpause operations.
    Pauser,
}

/// The SuperAdmin role constant — can be imported as `SUPER_ADMIN_ROLE` for
/// use in access-control gating without qualifying the full `Role` enum.
pub const SUPER_ADMIN_ROLE: Role = Role::SuperAdmin;

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Proposal {
    pub creator: Address,
    pub description: String,
    pub approvals: Vec<Address>,
    pub executed: bool,
}
