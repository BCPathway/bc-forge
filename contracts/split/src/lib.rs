#![no_std]

mod events;

#[cfg(test)]
mod test;

use bc_forge_admin as admin;
use bc_forge_token::BcForgeTokenClient;
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Recipient {
    pub to: Address,
    pub amount: i128,
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
        let client = BcForgeTokenClient::new(env, token_id);
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
                events::emit_payout_failed(env, invoice_id, &recipient.to);
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
            events::emit_payout_failed(env, invoice_id, recipient);
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

    pub fn release_payment(
        env: Env,
        invoice_id: u64,
        admin_address: Address,
    ) -> Result<(), SplitError> {
        admin::require_super_admin(&env, &admin_address);
        Self::release_payment_inner(&env, invoice_id)
    }

    pub fn retry_failed_payout(
        env: Env,
        invoice_id: u64,
        recipient: Address,
        admin_address: Address,
    ) -> Result<(), SplitError> {
        admin::require_super_admin(&env, &admin_address);
        Self::retry_failed_payout_inner(&env, invoice_id, &recipient)
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
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
enum DataKey {
    Invoice(u64),
    Token,
    FailedPayout(u64, Address),
}
