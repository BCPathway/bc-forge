#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

const ROLE_TTL_LEDGERS: u32 = 4096;

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum Role {
    Admin,
    Minter,
    Pauser,
    SuperAdmin,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Role(Role, Address),
}

fn admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

fn role_key(role: &Role, account: &Address) -> DataKey {
    DataKey::Role(role.clone(), account.clone())
}

fn has_role_internal(env: &Env, role: &Role, account: &Address) -> bool {
    if account == &env.current_contract_address() {
        return false;
    }

    if matches!(role, Role::Admin | Role::SuperAdmin) {
        if let Some(current_admin) = admin(env) {
            if &current_admin == account {
                return true;
            }
        }
    }

    env.storage()
        .persistent()
        .get(&role_key(role, account))
        .unwrap_or(false)
}

fn require_role_internal(env: &Env, role: &Role, account: &Address) {
    if !has_role_internal(env, role, account) {
        panic!("Unauthorized: caller does not have the required role");
    }
}

#[contract]
pub struct AdminContract;

#[contractimpl]
impl AdminContract {
    pub fn set_admin(env: Env, new_admin: Address) {
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events()
            .publish((symbol_short!("role_grant"),), (new_admin, Role::Admin));
    }

    pub fn get_admin(env: Env) -> Address {
        admin(&env).unwrap_or_else(|| panic!("Admin is not initialized"))
    }

    pub fn has_admin(env: Env, account: Address) -> bool {
        admin(&env).map(|current| current == account).unwrap_or(false)
    }

    pub fn get_role_admin(_env: Env, _role: Role) -> Role {
        Role::Admin
    }

    pub fn has_role(env: Env, role: Role, account: Address) -> bool {
        let result = has_role_internal(&env, &role, &account);
        env.events().publish(
            (symbol_short!("role_chk"),),
            (account, role, result),
        );
        result
    }

    pub fn grant_role(env: Env, role: Role, account: Address) {
        let current_admin = admin(&env).unwrap_or_else(|| panic!("Admin is not initialized"));
        current_admin.require_auth();

        let key = role_key(&role, &account);
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, ROLE_TTL_LEDGERS, ROLE_TTL_LEDGERS);
        env.events()
            .publish((symbol_short!("role_grant"),), (account, role));
    }

    pub fn revoke_role(env: Env, role: Role, account: Address) {
        let current_admin = admin(&env).unwrap_or_else(|| panic!("Admin is not initialized"));
        current_admin.require_auth();

        let key = role_key(&role, &account);
        env.storage().persistent().set(&key, &false);
        env.storage()
            .persistent()
            .extend_ttl(&key, ROLE_TTL_LEDGERS, ROLE_TTL_LEDGERS);
        env.events()
            .publish((symbol_short!("role_revoke"),), (account, role));
    }

    pub fn require_role(env: Env, role: Role, account: Address) {
        require_role_internal(&env, &role, &account);
    }

    pub fn require_role_guard(env: Env, role: Role, account: Address) {
        require_role_internal(&env, &role, &account);
    }

    pub fn require_admin(env: Env, account: Address) {
        let current_admin = admin(&env).unwrap_or_else(|| panic!("Admin is not initialized"));
        if current_admin != account {
            panic!("Unauthorized: caller is not the admin");
        }
    }

    pub fn require_minter(env: Env, account: Address) {
        require_role_internal(&env, &Role::Minter, &account);
    }

    pub fn require_super_admin(env: Env, account: Address) {
        // Admin is the root authority and implicitly holds SuperAdmin. Check it
        // first to avoid an unnecessary persistent-storage read in the common
        // case, then fall back to an explicitly granted SuperAdmin role.
        if admin(&env).as_ref() == Some(&account) {
            return;
        }

        let key = role_key(&Role::SuperAdmin, &account);
        if env.storage().persistent().get::<_, bool>(&key).unwrap_or(false) {
            return;
        }

        panic!("Unauthorized: caller does not have the SuperAdmin role");
    }
}

pub trait AdminInterface {
    fn set_admin(env: Env, new_admin: Address);
    fn get_admin(env: Env) -> Address;
    fn has_admin(env: Env, account: Address) -> bool;
    fn get_role_admin(env: Env, role: Role) -> Role;
    fn has_role(env: Env, role: Role, account: Address) -> bool;
    fn grant_role(env: Env, role: Role, account: Address);
    fn revoke_role(env: Env, role: Role, account: Address);
    fn require_role(env: Env, role: Role, account: Address);
    fn require_role_guard(env: Env, role: Role, account: Address);
    fn require_admin(env: Env, account: Address);
    fn require_minter(env: Env, account: Address);
    fn require_super_admin(env: Env, account: Address);
}
