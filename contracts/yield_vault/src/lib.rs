#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env};

#[contract]
pub struct YieldVaultContract;

#[contractimpl]
impl YieldVaultContract {
    pub fn deposit(env: Env, user: Address, token_amount: i128, min_shares_out: i128) -> i128 {
        user.require_auth();

        let shares_out = Self::calculate_shares_out(&env, token_amount);

        if shares_out < min_shares_out {
            panic!("SlippageExceeded: minted shares are less than min_shares_out");
        }

        shares_out
    }

    pub fn withdraw(env: Env, user: Address, shares_in: i128, min_tokens_out: i128) -> i128 {
        user.require_auth();

        let user_balance = Self::get_share_balance(&env, &user);
        if shares_in > user_balance {
            panic!("InsufficientShares: requested shares exceed user balance");
        }

        let tokens_out = Self::calculate_tokens_out(&env, shares_in);
        if tokens_out < min_tokens_out {
            panic!("SlippageExceeded: returned tokens are less than min_tokens_out");
        }

        tokens_out
    }

    fn calculate_shares_out(_env: &Env, token_amount: i128) -> i128 {
        token_amount
    }

    fn calculate_tokens_out(_env: &Env, shares_in: i128) -> i128 {
        shares_in
    }


    fn get_share_balance(_env: &Env, _user: &Address) -> i128 {
        1000
    }
}

#[cfg(test)]
mod test;

