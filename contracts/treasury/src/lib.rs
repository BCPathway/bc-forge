#![no_std]

mod events;

use bc_forge_admin as admin;
use soroban_sdk::token::TokenClient;
use soroban_sdk::{contract, contractimpl, contracttype, contracterror, Address, Env, String};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    TokenContract,
    Balance(Address),
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[contracterror]
#[repr(u32)]
pub enum TreasuryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientBalance = 4,
    Unauthorized = 5,
    TokenTransferFailed = 6,
}

#[contract]
pub struct TreasuryContract;

impl TreasuryContract {
    fn ensure_initialized(env: &Env) -> Result<(), TreasuryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            Ok(())
        } else {
            Err(TreasuryError::NotInitialized)
        }
    }

    fn read_admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    fn read_token(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::TokenContract)
            .expect("token contract not set")
    }

    fn read_balance(env: &Env, id: &Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id.clone()))
            .unwrap_or(0)
    }

    fn write_balance(env: &Env, id: &Address, balance: i128) {
        env.storage()
            .persistent()
            .set(&DataKey::Balance(id.clone()), &balance);
    }
}

#[contractimpl]
impl TreasuryContract {
    pub fn initialize(env: Env, admin: Address, token_contract: Address) -> Result<(), TreasuryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TreasuryError::AlreadyInitialized);
        }
        admin::set_admin(&env, &admin);
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::TokenContract, &token_contract);
        events::emit_initialized(&env, &admin, &token_contract);
        Ok(())
    }

    // Depositor must authorize; tokens are transferred into this contract before internal accounting updated
    pub fn deposit(env: Env, depositor: Address, amount: i128) -> Result<(), TreasuryError> {
        Self::ensure_initialized(&env)?;
        depositor.require_auth();
        if amount <= 0 {
            return Err(TreasuryError::InvalidAmount);
        }

        let token = Self::read_token(&env);
        let client = TokenClient::new(&env, &token);

        // Attempt transfer_from depositor -> this_contract
        client.transfer_from(&env.current_contract_address(), &depositor, &env.current_contract_address(), &amount);

        // Update internal balance after successful transfer
        let new_balance = Self::read_balance(&env, &env.current_contract_address()) + amount;
        Self::write_balance(&env, &env.current_contract_address(), new_balance);

        events::emit_deposit(&env, &depositor, &amount, &new_balance);
        Ok(())
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::ensure_initialized(&env).unwrap();
        Self::read_balance(&env, &id)
    }
}
