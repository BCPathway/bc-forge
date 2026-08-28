use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    DepositBlock(Address),
}

#[contract]
pub struct FlashLoanGuardContract;

#[contractimpl]
impl FlashLoanGuardContract {
    pub fn deposit(env: Env, user: Address) {
        user.require_auth();
        let current_block = env.ledger().sequence();
        env.storage()
            .persistent()
            .set(&DataKey::DepositBlock(user.clone()), &current_block);
    }

    pub fn withdraw(env: Env, user: Address) {
        user.require_auth();
        let current_block = env.ledger().sequence();

        let deposit_block: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::DepositBlock(user.clone()))
            .unwrap_or(0);

        if current_block <= deposit_block {
            panic!(
                "FlashLoanReentrancy: withdrawal prohibited in the same ledger block as deposit"
            );
        }

        // Proceed with withdrawal logic...
        env.storage()
            .persistent()
            .remove(&DataKey::DepositBlock(user));
    }
}
