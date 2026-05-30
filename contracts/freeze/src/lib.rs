#![no_std]

use soroban_sdk::{contracttype, symbol_short, Address, Env};

#[derive(Clone)]
#[contracttype]
pub enum FreezeKey {
    Address(Address),
    All,
}

pub fn freeze_address(env: &Env, admin: Address, address: Address) {
    admin.require_auth();
    env.storage()
        .persistent()
        .set(&FreezeKey::Address(address.clone()), &true);
    emit_address_frozen(env, &admin, &address);
}

pub fn unfreeze_address(env: &Env, admin: Address, address: Address) {
    admin.require_auth();
    env.storage()
        .persistent()
        .remove(&FreezeKey::Address(address.clone()));
    emit_address_unfrozen(env, &admin, &address);
}

pub fn is_address_frozen(env: &Env, address: &Address) -> bool {
    env.storage()
        .persistent()
        .get(&FreezeKey::Address(address.clone()))
        .unwrap_or(false)
}

pub fn freeze_all(env: &Env, admin: Address) {
    admin.require_auth();
    env.storage().persistent().set(&FreezeKey::All, &true);
    emit_global_frozen(env, &admin);
}

pub fn unfreeze_all(env: &Env, admin: Address) {
    admin.require_auth();
    env.storage().persistent().remove(&FreezeKey::All);
    emit_global_unfrozen(env, &admin);
}

pub fn is_all_frozen(env: &Env) -> bool {
    env.storage()
        .persistent()
        .get(&FreezeKey::All)
        .unwrap_or(false)
}

pub fn is_frozen(env: &Env, address: &Address) -> bool {
    if is_all_frozen(env) {
        true
    } else {
        is_address_frozen(env, address)
    }
}

fn emit_address_frozen(env: &Env, admin: &Address, address: &Address) {
    env.events().publish(
        (symbol_short!("frze"),),
        (admin.clone(), address.clone()),
    );
}

fn emit_address_unfrozen(env: &Env, admin: &Address, address: &Address) {
    env.events().publish(
        (symbol_short!("unfr"),),
        (admin.clone(), address.clone()),
    );
}

fn emit_global_frozen(env: &Env, admin: &Address) {
    env.events().publish((symbol_short!("glfz"),), (admin.clone(),));
}

fn emit_global_unfrozen(env: &Env, admin: &Address) {
    env.events().publish((symbol_short!("gufz"),), (admin.clone(),));
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{contract, contractimpl, Env};

    #[contract]
    struct FreezeContract;

    #[contractimpl]
    impl FreezeContract {
        pub fn freeze_address(env: Env, admin: Address, address: Address) {
            super::freeze_address(&env, admin, address);
        }

        pub fn unfreeze_address(env: Env, admin: Address, address: Address) {
            super::unfreeze_address(&env, admin, address);
        }

        pub fn is_address_frozen(env: Env, address: Address) -> bool {
            super::is_address_frozen(&env, &address)
        }

        pub fn freeze_all(env: Env, admin: Address) {
            super::freeze_all(&env, admin);
        }

        pub fn unfreeze_all(env: Env, admin: Address) {
            super::unfreeze_all(&env, admin);
        }

        pub fn is_all_frozen(env: Env) -> bool {
            super::is_all_frozen(&env)
        }

        pub fn is_frozen(env: Env, address: Address) -> bool {
            super::is_frozen(&env, &address)
        }
    }

    #[test]
    fn test_freeze_and_unfreeze_address() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreezeContract, ());
        let client = FreezeContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.freeze_address(&admin, &user);
        assert!(client.is_address_frozen(&user));

        client.unfreeze_address(&admin, &user);
        assert!(!client.is_address_frozen(&user));
    }

    #[test]
    fn test_freeze_all_blocks_addresses() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(FreezeContract, ());
        let client = FreezeContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let user = Address::generate(&env);

        client.freeze_all(&admin);
        assert!(client.is_all_frozen());
        assert!(client.is_frozen(&user));

        client.unfreeze_all(&admin);
        assert!(!client.is_all_frozen());
        assert!(!client.is_frozen(&user));
    }
}
