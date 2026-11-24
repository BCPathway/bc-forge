#![no_std]
// SPDX-License-Identifier: MIT

mod events;
mod reentrancy_guard;

#[cfg(test)]
mod test;

#[cfg(test)]
mod upgrade_batch_test;

use bc_forge_admin as admin;
use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, Address, BytesN, Env,
    String, Vec,
};

/// Maximum number of recipients allowed on a single invoice. Keeping this
/// bounded prevents `release_payment` from exceeding Soroban's CPU limit and
/// permanently locking funds.
const MAX_RECIPIENTS: u32 = 100;

/// Minimal SEP-41 client so this crate does not link `bc-forge-token`'s WASM
/// exports (those collide with this contract's upgrade-governance entry points).
#[contractclient(name = "TokenClient")]
pub trait TokenInterface {
    fn balance(id: Address) -> i128;
    fn transfer(from: Address, to: Address, amount: i128);
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Recipient {
    pub to: Address,
    pub amount: i128,
}

/// A recipient expressed as a share of the invoice total in basis points
/// (#1463). 10,000 bps is 100%.
#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct RecipientBps {
    pub to: Address,
    pub bps: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum InvoiceStatus {
    Pending,
    PartiallyReleased,
    FullyReleased,
    Failed,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct FailedPayout {
    pub invoice_id: u64,
    pub recipient: Address,
    pub amount: i128,
    pub retry_count: u32,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Invoice {
    pub invoice_id: u64,
    pub total_amount: i128,
    pub released_amount: i128,
    pub status: InvoiceStatus,
    pub recipients: Vec<Recipient>,
    pub created_at: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum SplitError {
    InvoiceNotFound = 1,
    InvalidRecipient = 2,
    InsufficientBalance = 3,
    InvoiceAlreadyCompleted = 4,
    FailedPayoutNotFound = 5,
    /// Basis-point shares must add up to exactly 10,000 (#1463).
    InvalidBasisPointsTotal = 6,
    /// The split contract has no token configured yet (#1463).
    TokenNotConfigured = 7,
    TooManyRecipients = 8,
    DuplicateRecipient = 9,
    InvalidAmount = 10,
}

#[contract]
pub struct SplitContract;

impl SplitContract {
    fn ensure_invoice_exists(env: &Env, invoice_id: u64) -> Result<(), SplitError> {
        let key = DataKey::Invoice(invoice_id);
        if !env.storage().persistent().has(&key) {
            Err(SplitError::InvoiceNotFound)
        } else {
            Ok(())
        }
    }

    fn read_invoice(env: &Env, invoice_id: u64) -> Result<Invoice, SplitError> {
        let key = DataKey::Invoice(invoice_id);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(SplitError::InvoiceNotFound)
    }

    fn write_invoice(env: &Env, invoice: &Invoice) {
        let key = DataKey::Invoice(invoice.invoice_id);
        env.storage().persistent().set(&key, invoice);
    }

    fn next_invoice_id(env: &Env) -> u64 {
        let mut id = env
            .storage()
            .instance()
            .get(&DataKey::NextInvoiceId)
            .unwrap_or(0u64);
        // Invoice ids may also be supplied manually via `create_invoice`;
        // never overwrite one of those.
        while env.storage().persistent().has(&DataKey::Invoice(id)) {
            id += 1;
        }
        env.storage()
            .instance()
            .set(&DataKey::NextInvoiceId, &(id + 1));
        id
    }

    fn read_failed_payout(env: &Env, invoice_id: u64, recipient: &Address) -> Option<FailedPayout> {
        let key = DataKey::FailedPayout(invoice_id, recipient.clone());
        env.storage().persistent().get(&key)
    }

    fn write_failed_payout(env: &Env, failed_payout: &FailedPayout) {
        let key = DataKey::FailedPayout(failed_payout.invoice_id, failed_payout.recipient.clone());
        env.storage().persistent().set(&key, failed_payout);
    }

    fn remove_failed_payout(env: &Env, invoice_id: u64, recipient: &Address) {
        let key = DataKey::FailedPayout(invoice_id, recipient.clone());
        env.storage().persistent().remove(&key);
    }

    fn try_transfer(
        env: &Env,
        token_id: &Address,
        from: &Address,
        to: &Address,
        amount: i128,
    ) -> bool {
        let client = TokenClient::new(env, token_id);
        let from_balance = client.balance(from);
        if from_balance < amount || amount <= 0 {
            return false;
        }
        client.transfer(from, to, &amount);
        true
    }

    fn release_payment_inner(env: &Env, invoice_id: u64) -> Result<(), SplitError> {
        let token_address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(SplitError::InsufficientBalance)?;

        let mut invoice = Self::read_invoice(env, invoice_id)?;
        if invoice.status != InvoiceStatus::Pending {
            return Err(SplitError::InvoiceAlreadyCompleted);
        }

        let mut total_to_release = 0i128;
        let mut failed_count = 0;
        let mut invoice_updated = false;
        let current_contract = env.current_contract_address();

        for recipient in &invoice.recipients {
            let failed_payout_opt = Self::read_failed_payout(env, invoice_id, &recipient.to);

            if let Some(ref failed_payout) = failed_payout_opt {
                if failed_payout.retry_count >= 3 {
                    continue;
                }
            }

            let succeeded = Self::try_transfer(
                env,
                &token_address,
                &current_contract,
                &recipient.to,
                recipient.amount,
            );

            if succeeded {
                total_to_release += recipient.amount;
                invoice_updated = true;
            } else {
                failed_count += 1;
                let retry_count = failed_payout_opt.map_or(1, |fp| fp.retry_count + 1);
                let failed_payout = FailedPayout {
                    invoice_id,
                    recipient: recipient.to.clone(),
                    amount: recipient.amount,
                    retry_count,
                };
                Self::write_failed_payout(env, &failed_payout);
                events::emit_payout_failed(
                    env,
                    invoice_id,
                    &recipient.to,
                    failed_payout.amount,
                    failed_payout.retry_count,
                );
            }
        }

        if invoice_updated {
            invoice.released_amount = total_to_release;
            if failed_count == invoice.recipients.len() {
                invoice.status = InvoiceStatus::Failed;
            } else if total_to_release == invoice.total_amount {
                invoice.status = InvoiceStatus::FullyReleased;
            } else {
                invoice.status = InvoiceStatus::PartiallyReleased;
            }
            Self::write_invoice(env, &invoice);
        }

        Ok(())
    }

    fn retry_failed_payout_inner(
        env: &Env,
        invoice_id: u64,
        recipient: &Address,
    ) -> Result<(), SplitError> {
        Self::ensure_invoice_exists(env, invoice_id)?;

        let mut failed_payout = Self::read_failed_payout(env, invoice_id, recipient)
            .ok_or(SplitError::FailedPayoutNotFound)?;

        if failed_payout.retry_count >= 3 {
            return Err(SplitError::InvoiceAlreadyCompleted);
        }

        let token_address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(SplitError::InsufficientBalance)?;
        let current_contract = env.current_contract_address();

        let succeeded = Self::try_transfer(
            env,
            &token_address,
            &current_contract,
            recipient,
            failed_payout.amount,
        );

        if succeeded {
            Self::remove_failed_payout(env, invoice_id, recipient);
            events::emit_payout_succeeded(env, invoice_id, recipient, failed_payout.amount);
            Ok(())
        } else {
            failed_payout.retry_count += 1;
            Self::write_failed_payout(env, &failed_payout);
            events::emit_payout_failed(
                env,
                invoice_id,
                recipient,
                failed_payout.amount,
                failed_payout.retry_count,
            );
            Err(SplitError::InsufficientBalance)
        }
    }
}

#[contractimpl]
impl SplitContract {
    pub fn create_invoice(
        env: Env,
        admin_address: Address,
        invoice_id: u64,
        total_amount: i128,
        recipients: Vec<Recipient>,
        token_address: Address,
    ) -> Result<(), SplitError> {
        admin::require_super_admin(&env, &admin_address);

        if total_amount <= 0 {
            return Err(SplitError::InvalidRecipient);
        }

        if recipients.len() > MAX_RECIPIENTS {
            return Err(SplitError::TooManyRecipients);
        }

        // Duplicate destinations would make a single payout ambiguous and can
        // result in a recipient being paid twice from the same invoice.
        for i in 0..recipients.len() {
            for j in (i + 1)..recipients.len() {
                if recipients.get(i).unwrap().to == recipients.get(j).unwrap().to {
                    return Err(SplitError::DuplicateRecipient);
                }
            }
        }

        let mut recipient_amounts: i128 = 0;
        for recipient in &recipients {
            if recipient.amount <= 0 {
                return Err(SplitError::InvalidRecipient);
            }
            recipient_amounts = match recipient_amounts.checked_add(recipient.amount) {
                Some(total) => total,
                None => return Err(SplitError::InvalidRecipient),
            };
        }

        if recipient_amounts != total_amount {
            return Err(SplitError::InvalidRecipient);
        }

        let invoice = Invoice {
            invoice_id,
            total_amount,
            released_amount: 0,
            status: InvoiceStatus::Pending,
            recipients,
            created_at: env.ledger().sequence(),
        };

        env.storage()
            .instance()
            .set(&DataKey::Token, &token_address);
        admin::set_admin(&env, &admin_address);
        Self::write_invoice(&env, &invoice);

        events::emit_invoice_created(&env, invoice_id, total_amount);
        Ok(())
    }

    /// Creates an invoice from basis-point (percentage) shares (#1463) using
    /// the token already configured on this contract.
    pub fn create_split_percentage(
        env: Env,
        payer: Address,
        total_amount: i128,
        recipients: Vec<RecipientBps>,
    ) -> Result<u64, SplitError> {
        // Validate the shares first so callers always get the basis-point
        // error for an invalid split, even on a fresh contract.
        if total_amount <= 0 {
            return Err(SplitError::InvalidRecipient);
        }
        let mut total_bps: u32 = 0;
        for r in recipients.iter() {
            total_bps = total_bps
                .checked_add(r.bps)
                .ok_or(SplitError::InvalidBasisPointsTotal)?;
        }
        if total_bps != 10_000 {
            return Err(SplitError::InvalidBasisPointsTotal);
        }

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(SplitError::TokenNotConfigured)?;

        Self::create_split_bps_with_token(env, payer, total_amount, recipients, token_address)
    }

    /// Percentage-split entry point for a contract that has no token
    /// configured yet (#1463).
    ///
    /// `bps` values must add up to exactly 10,000. The calculated amounts are
    /// stored as a regular invoice, so release/retry behave exactly as they do
    /// for invoices created with absolute amounts. Any rounding remainder is
    /// assigned to the last recipient so the invoice still balances to
    /// `total_amount`.
    pub fn create_split_bps_with_token(
        env: Env,
        payer: Address,
        total_amount: i128,
        recipients: Vec<RecipientBps>,
        token_address: Address,
    ) -> Result<u64, SplitError> {
        // `create_invoice` below enforces the super-admin guard, which also
        // authorizes `payer` for this invocation.
        if total_amount <= 0 {
            return Err(SplitError::InvalidRecipient);
        }

        let mut total_bps: u32 = 0;
        let mut split_recipients: Vec<Recipient> = Vec::new(&env);
        let mut allocated = 0i128;

        for r in recipients.iter() {
            total_bps = total_bps
                .checked_add(r.bps)
                .ok_or(SplitError::InvalidBasisPointsTotal)?;

            let recipient_amount = total_amount
                .checked_mul(r.bps as i128)
                .ok_or(SplitError::InvalidRecipient)?
                / 10_000;
            if recipient_amount <= 0 {
                return Err(SplitError::InvalidRecipient);
            }

            allocated = allocated
                .checked_add(recipient_amount)
                .ok_or(SplitError::InvalidRecipient)?;
            split_recipients.push_back(Recipient {
                to: r.to,
                amount: recipient_amount,
            });
        }

        if total_bps != 10_000 {
            return Err(SplitError::InvalidBasisPointsTotal);
        }

        // Integer division can leave dust; give it to the last recipient so
        // the standard invoice validation (sum == total_amount) still passes.
        if allocated < total_amount {
            let last_index = split_recipients.len() - 1;
            let mut last = split_recipients
                .get(last_index)
                .ok_or(SplitError::InvalidRecipient)?;
            last.amount = last
                .amount
                .checked_add(total_amount - allocated)
                .ok_or(SplitError::InvalidRecipient)?;
            split_recipients.set(last_index, last);
        }

        let invoice_id = Self::next_invoice_id(&env);
        Self::create_invoice(
            env,
            payer,
            invoice_id,
            total_amount,
            split_recipients,
            token_address,
        )?;
        Ok(invoice_id)
    }

    pub fn release_payment(
        env: Env,
        invoice_id: u64,
        admin_address: Address,
    ) -> Result<(), SplitError> {
        reentrancy_guard!(&env, "release_payment", {
            admin::require_super_admin(&env, &admin_address);
            Self::release_payment_inner(&env, invoice_id)
        })
    }

    /// Releases several invoices in a single transaction.
    ///
    /// Returns the IDs that were successfully released. A missing or already
    /// released invoice is skipped rather than aborting the rest of the batch.
    pub fn release_payment_batch(env: Env, invoice_ids: Vec<u64>) -> Vec<u64> {
        let admin_address = admin::get_admin(&env);
        reentrancy_guard!(&env, "release_payment_batch", {
            admin::require_super_admin(&env, &admin_address);
            let mut released = Vec::new(&env);
            for id in invoice_ids.iter() {
                if Self::release_payment_inner(&env, id).is_ok() {
                    released.push_back(id);
                }
            }
            released
        })
    }

    /// Rescues foreign SEP-41 tokens that were accidentally sent to this
    /// contract. Admin only; emits a `token_rescued` event on success.
    pub fn rescue_tokens(
        env: Env,
        caller: Address,
        token: Address,
        to: Address,
        amount: i128,
    ) -> Result<(), SplitError> {
        admin::require_admin(&env, &caller);

        if amount <= 0 {
            return Err(SplitError::InvalidAmount);
        }

        let client = TokenClient::new(&env, &token);
        let contract_address = env.current_contract_address();
        if client.balance(&contract_address) < amount {
            return Err(SplitError::InsufficientBalance);
        }

        client.transfer(&contract_address, &to, &amount);
        events::emit_token_rescued(&env, &token, &to, amount);
        Ok(())
    }

    pub fn retry_failed_payout(
        env: Env,
        invoice_id: u64,
        recipient: Address,
        admin_address: Address,
    ) -> Result<(), SplitError> {
        reentrancy_guard!(&env, "retry_failed_payout", {
            admin::require_super_admin(&env, &admin_address);
            Self::retry_failed_payout_inner(&env, invoice_id, &recipient)
        })
    }

    pub fn get_invoice(env: Env, invoice_id: u64) -> Result<Invoice, SplitError> {
        Self::read_invoice(&env, invoice_id)
    }

    pub fn get_failed_payout(
        env: Env,
        invoice_id: u64,
        recipient: Address,
    ) -> Result<FailedPayout, SplitError> {
        let failed_payout_opt = Self::read_failed_payout(&env, invoice_id, &recipient);
        failed_payout_opt.ok_or(SplitError::FailedPayoutNotFound)
    }

    /// Upgrades the split contract WASM (SuperAdmin path).
    ///
    /// @notice Replaces the current contract executable with `new_wasm_hash`.
    /// @dev Mirrors the token contract's SuperAdmin-gated upgrade entry point.
    pub fn upgrade(
        env: Env,
        upgrader: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), SplitError> {
        admin::require_super_admin(&env, &upgrader);
        events::emit_upgraded(&env, &upgrader, &new_wasm_hash);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Configures the multi-sig admin pool used to gate WASM upgrades.
    pub fn set_admin_pool(env: Env, pool: Vec<Address>, threshold: u32) {
        admin::set_admin_pool(&env, pool, threshold);
    }

    /// Creates a multi-sig governance proposal for an upgrade (or other action).
    pub fn create_proposal(env: Env, creator: Address, description: String) -> u64 {
        admin::create_proposal(&env, creator, description)
    }

    /// Approves a multi-sig governance proposal.
    pub fn approve_proposal(env: Env, admin_address: Address, proposal_id: u64) {
        admin::approve_proposal(&env, admin_address, proposal_id);
    }

    /// Returns whether a governance proposal has met its approval quorum.
    pub fn is_proposal_ready(env: Env, proposal_id: u64) -> bool {
        admin::is_proposal_ready(&env, proposal_id)
    }

    /// Executes a quorum-approved WASM upgrade on this split contract.
    ///
    /// @notice Applies `wasm_hash` after the referenced proposal meets quorum.
    /// @dev Delegates to [`admin::execute_upgrade`].
    pub fn execute_upgrade(
        env: Env,
        executor: Address,
        proposal_id: u64,
        wasm_hash: BytesN<32>,
    ) -> Result<(), admin::AdminError> {
        admin::execute_upgrade(&env, executor, proposal_id, wasm_hash)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
enum DataKey {
    Invoice(u64),
    NextInvoiceId,
    Token,
    FailedPayout(u64, Address),
}
