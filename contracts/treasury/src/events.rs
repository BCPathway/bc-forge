use soroban_sdk::{Address, Env};

pub fn emit_initialized(env: &Env, admin: &Address, token: &Address) {
    env.events().publish(("treasury","initialized"), (admin.clone(), token.clone()));
}

pub fn emit_deposit(env: &Env, depositor: &Address, amount: &i128, new_balance: &i128) {
    env.events().publish(("treasury","deposit"), (depositor.clone(), *amount, *new_balance));
}
