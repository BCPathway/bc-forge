// SPDX-License-Identifier: MIT
//! Privileged-action timelock and role-hierarchy queries.
//!
//! Two concerns live here because they are both "admin contract surface the
//! issue set asked for" and share the same storage keys:
//!
//! 1. **Privileged-action timelock (#914).** A compromised admin key can
//!    currently change fees (`token::set_fee_config`) or hand over ownership
//!    (`token::transfer_ownership`) in one transaction. WASM upgrades already
//!    run through the multi-sig + timelock flow; fee config and ownership
//!    transfer now get the same delay. Each action is *proposed* by an admin,
//!    waits [`PRIVILEGE_DELAY_SECS`], and is then *executed* by an admin.
//!    Executing before the delay fails with
//!    [`AdminError::PrivilegeTimelockActive`]. The token contract consults
//!    `consume_privilege_proposal` inside `set_fee_config` and
//!    `transfer_ownership` so the delay is enforced where the effect happens,
//!    not merely in this contract's bookkeeping.
//!
//! 2. **Role-hierarchy query (#915).** One call returns whether an address
//!    holds each of Admin, SuperAdmin, Minter and Pauser, plus `renounce_role`
//!    so a holder can drop their own role. Renouncing the last SuperAdmin
//!    fails — recovery must not depend on nobody being able to act.

use crate::{AdminError, AdminKey, Role};
use soroban_sdk::{contracttype, Address, Env};

/// Unix seconds a proposed privileged action must wait before it can execute.
/// Mirrors the upgrade timelock in `multisig::TIMELOCK_DELAY_SECS` (24h) so
/// operators get the same reaction window for every privileged class: pause,
/// review, and if needed cancel the pending action.
pub const PRIVILEGE_ACTION_DELAY_SECS: u64 = 24 * 60 * 60;

/// Maximum privileged proposals tracked. Each proposal is one persistent
/// entry; the cap bounds storage growth. If every slot is occupied, a new
/// proposal must replace an executed/cancelled one or the submit is rejected.
pub const MAX_PRIVILEGE_PROPOSALS: u32 = 32;

/// The privileged action a proposal will perform once its timelock expires.
///
/// Encoded as a `#[contracttype]` so the stored proposal survives
/// serialization unchanged, and so adding a new action variant later is an
/// additive change (new enum member) rather than a re-encode.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PrivilegeAction {
    /// Apply `fee_config` to the token contract.
    SetFeeConfig,
    /// Transfer contract ownership (admin) to `new_admin`.
    TransferOwnership(Address),
}

/// A proposed privileged action awaiting its timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PrivilegeProposal {
    /// Admin that submitted the action. Only this address (or a later admin)
    /// may execute or cancel it.
    pub submitter: Address,
    /// The action to perform.
    pub action: PrivilegeAction,
    /// Unix timestamp (seconds) when the action may execute. Recorded once at
    /// submission; resubmitting the same action restarts the clock.
    pub executable_at: u64,
    /// Whether the action has been executed. Terminal.
    pub executed: bool,
    /// Whether the action was cancelled by its submitter. Terminal.
    pub cancelled: bool,
}

/// Storage: the current proposal for a given action kind. One live proposal
/// per action kind keeps the surface predictable: a submit replaces any
/// cancelled/executed prior proposal for the same kind and rejects while a
/// live one is pending.
fn privilege_proposal_key(action: &PrivilegeAction) -> AdminKey {
    AdminKey::PrivilegeProposal(action.clone())
}

fn read_privilege_proposal(env: &Env, action: &PrivilegeAction) -> Option<PrivilegeProposal> {
    env.storage()
        .persistent()
        .get(&privilege_proposal_key(action))
}

fn write_privilege_proposal(env: &Env, proposal: &PrivilegeProposal) {
    let key = privilege_proposal_key(&proposal.action);
    env.storage().persistent().set(&key, proposal);
    // Give the persistent entry its own fresh TTL so a pending proposal's
    // clock cannot be archived mid-flight. The crate's private helper is the
    // canonical bump; call it through the pub(crate) re-export below.
    crate::bump_persistent_key(env, &key);
}

/// Proposes a privileged action. Admin-only.
///
/// Replaces a previously executed or cancelled proposal for the same action
/// kind (a fresh proposal with a fresh delay); rejects while a live proposal
/// for the same kind is still pending, so two admins cannot race two clocks
/// for the same effect.
pub fn propose_privilege_action(
    env: &Env,
    submitter: Address,
    action: PrivilegeAction,
) -> Result<u64, AdminError> {
    // `require_admin` both checks the role and enforces `submitter`'s
    // authorization; an extra `submitter.require_auth()` here would ask the
    // same frame to authorize twice and fail with an auth error.
    crate::rbac::require_admin(env, &submitter);

    if let Some(existing) = read_privilege_proposal(env, &action) {
        if !existing.executed && !existing.cancelled {
            return Err(AdminError::PrivilegeProposalNotFound);
        }
    }

    let executable_at = env.ledger().timestamp() + PRIVILEGE_ACTION_DELAY_SECS;
    let proposal = PrivilegeProposal {
        submitter: submitter.clone(),
        action: action.clone(),
        executable_at,
        executed: false,
        cancelled: false,
    };
    write_privilege_proposal(env, &proposal);
    crate::events::emit_privilege_proposed(env, &submitter, &action, executable_at);
    Ok(executable_at)
}

/// Cancels a pending privileged action. Admin-only (the submitter or any
/// later admin — cancellation is the emergency brake, it must not be gated on
/// one key that may be the compromised one).
pub fn cancel_privilege_action(
    env: &Env,
    caller: Address,
    action: PrivilegeAction,
) -> Result<(), AdminError> {
    // See `propose_privilege_action`: `require_admin` already enforces the
    // caller's authorization.
    crate::rbac::require_admin(env, &caller);

    let mut proposal =
        read_privilege_proposal(env, &action).ok_or(AdminError::PrivilegeProposalNotFound)?;
    if proposal.executed || proposal.cancelled {
        return Err(AdminError::PrivilegeProposalNotFound);
    }
    proposal.cancelled = true;
    write_privilege_proposal(env, &proposal);
    crate::events::emit_privilege_cancelled(env, &caller, &action);
    Ok(())
}

/// Marks the proposal executed and returns `Ok(())` if the timelock has
/// elapsed; errors otherwise. Called by the token contract inside the actual
/// privileged effect, so the delay is enforced at the point of effect.
///
/// The caller (`executor`) must be the contract admin; `require_admin` is
/// enforced by the caller's own authorization flow, and `executor` has
/// already required auth by the time this runs.
pub fn consume_privilege_proposal(env: &Env, action: &PrivilegeAction) -> Result<(), AdminError> {
    let proposal =
        read_privilege_proposal(env, action).ok_or(AdminError::PrivilegeProposalNotFound)?;
    if proposal.executed || proposal.cancelled {
        return Err(AdminError::PrivilegeProposalNotFound);
    }
    if env.ledger().timestamp() < proposal.executable_at {
        return Err(AdminError::PrivilegeTimelockActive);
    }
    let mut proposal = proposal;
    proposal.executed = true;
    write_privilege_proposal(env, &proposal);
    crate::events::emit_privilege_executed(env, action);
    Ok(())
}

/// Read-only view of a privileged proposal, for operators and UIs.
pub fn get_privilege_proposal(env: &Env, action: PrivilegeAction) -> Option<PrivilegeProposal> {
    read_privilege_proposal(env, &action)
}

// ─────────────────────────────────────────────────────────────────────────────
// #915 — role-hierarchy query + renounce_role
// ─────────────────────────────────────────────────────────────────────────────

/// One address's role membership across the whole hierarchy, in one call.
///
/// `admin_implies_all` mirrors `get_roles_bitmask`: the configured admin
/// implicitly holds every role, so a UI reading this query sees the full
/// truth rather than the raw storage bits.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleHierarchy {
    pub address: Address,
    pub is_admin: bool,
    pub is_super_admin: bool,
    pub is_minter: bool,
    pub is_pauser: bool,
}

/// Ordered role set with membership flags for `address` (#915).
pub fn get_role_hierarchy(env: &Env, address: Address) -> RoleHierarchy {
    let bitmask = crate::rbac::get_roles_bitmask(env, &address);
    RoleHierarchy {
        address,
        is_admin: bitmask & crate::rbac::RoleFlags::Admin.bits() != 0,
        is_super_admin: bitmask & crate::rbac::RoleFlags::SuperAdmin.bits() != 0,
        is_minter: bitmask & crate::rbac::RoleFlags::Minter.bits() != 0,
        is_pauser: bitmask & crate::rbac::RoleFlags::Pauser.bits() != 0,
    }
}

/// Drops a role the caller holds from themselves (#915).
///
/// - A non-holder gets [`AdminError::RoleNotHeldForRenounce`], not a silent
///   success.
/// - The **last** SuperAdmin cannot renounce ([`AdminError::LastSuperAdmin`]):
///   recovery must never depend on a chain with no one able to grant roles.
///
/// Only **directly granted** roles can be renounced: the roles implied by the
/// Admin bit have no storage of their own (admin authority changes via
/// `set_admin`), so renouncing an Admin-implied role returns
/// [`AdminError::RoleNotHeldForRenounce`] rather than corrupting the mask.
pub fn renounce_role(env: &Env, caller: Address, role: Role) -> Result<(), AdminError> {
    caller.require_auth();

    // Effective check first: an Admin-bit holder passes this for every role,
    // so the more specific raw-mask error below is what a UI sees.
    if !crate::rbac::has_role(env, role, &caller) {
        return Err(AdminError::RoleNotHeldForRenounce);
    }

    if role == Role::SuperAdmin {
        // Renouncing SuperAdmin must not leave the chain with nobody able to
        // grant roles. The configured admin always counts as a holder — the
        // Admin role implies SuperAdmin and `set_admin` can restore it — so
        // any caller other than the admin is safe up front. Otherwise, scan
        // the pool for an OTHER address whose raw mask carries the
        // SuperAdmin bit (raw, not the expanded view, so the caller's own
        // Admin bit cannot satisfy the guard for themself).
        let mut other_super_admin = crate::rbac::get_admin(env) != caller;
        if !other_super_admin {
            let pool = crate::multisig::get_admin_pool(env);
            for i in 0..pool.len() {
                let member = pool.get(i).expect("index in range");
                if member != caller
                    && crate::rbac::load_raw_role_mask(env, &member)
                        & crate::rbac::RoleFlags::SuperAdmin.bits()
                        != 0
                {
                    other_super_admin = true;
                    break;
                }
            }
        }
        if !other_super_admin {
            return Err(AdminError::LastSuperAdmin);
        }
    }

    // The holder is renouncing their own role, so no SuperAdmin
    // counter-signature applies — go straight to the unauthorized-state
    // helper instead of `revoke_role`'s `require_super_admin` path.
    //
    // Only a DIRECTLY granted role has its own bit to clear. A role held
    // implicitly through the Admin bit has no separate storage; renouncing
    // it is rejected instead of silently no-op'ing.
    let bit = crate::rbac::RoleFlags::from_role(role).bits();
    if crate::rbac::load_raw_role_mask(env, &caller) & bit == 0 {
        return Err(AdminError::RoleNotHeldForRenounce);
    }
    crate::rbac::_revoke_role(env, role, &caller)
}
