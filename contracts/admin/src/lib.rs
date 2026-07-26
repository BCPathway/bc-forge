#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Vec};

const ADMIN_KEY: &str = "Admin";
const ROLE_KEY: &str = "Role";
const UNAUTHORIZED_SUPER_ADMIN: &str = "Unauthorized: caller is not a super admin";

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum Role {
    Admin,
    Minter,
    Pauser,
    SuperAdmin,
}

fn admin_key(env: &Env) -> Symbol {
    Symbol::new(env, ADMIN_KEY)
}

fn role_key(env: &Env, role: &Role, account: &Address) -> (Symbol, Vec<Role>, Address) {
    (
        Symbol::new(env, ROLE_KEY),
        Vec::from_array(env, [role.clone()]),
        account.clone(),
    )
}

fn role_is_stored(env: &Env, role: &Role, account: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<_, bool>(&role_key(env, role, account))
        .unwrap_or(false)
}

fn stored_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&admin_key(env))
}

#[contract]
pub struct AdminContract;

#[contractimpl]
impl AdminContract {
    pub fn set_admin(env: Env, admin: Address) {
        if let Some(current_admin) = stored_admin(&env) {
            current_admin.require_auth();
        }

        env.storage().instance().set(&admin_key(&env), &admin);
        env.storage().instance().extend_ttl(100, 100);
        Self::grant_role_internal(&env, &Role::Admin, &admin);
    }

    pub fn get_admin(env: Env) -> Address {
        stored_admin(&env).unwrap_or_else(|| panic!("admin is not initialized"))
    }

    pub fn get_role_admin(env: Env) -> Address {
        Self::get_admin(env)
    }

    pub fn has_admin(env: Env, account: Address) -> bool {
        stored_admin(&env).map_or(false, |admin| admin == account)
    }

    pub fn grant_role(env: Env, role: Role, account: Address) {
        Self::get_admin(env.clone()).require_auth();
        Self::grant_role_internal(&env, &role, &account);
    }

    pub fn revoke_role(env: Env, role: Role, account: Address) {
        Self::get_admin(env.clone()).require_auth();

        let key = role_key(&env, &role, &account);
        env.storage().persistent().remove(&key);

        env.events().publish(
            (Symbol::new(&env, "role_revoked"), role, account),
            (),
        );
    }

    pub fn has_role(env: Env, role: Role, account: Address) -> bool {
        let held = Self::has_role_internal(&env, &role, &account);

        env.events().publish(
            (Symbol::new(&env, "role_chk"),),
            (account, role, held),
        );

        held
    }

    pub fn require_role(env: Env, role: Role, account: Address) {
        account.require_auth();
        if !Self::has_role_internal(&env, &role, &account) {
            panic!("Unauthorized: required role is not held");
        }
    }

    pub fn require_role_guard(env: Env, role: Role, account: Address) {
        Self::require_role(env, role, account);
    }

    pub fn require_minter(env: Env, account: Address) {
        Self::require_role(env, Role::Minter, account);
    }

    pub fn require_super_admin(env: Env, account: Address) {
        account.require_auth();

        if !role_is_stored(&env, &Role::SuperAdmin, &account) {
            panic!("{}", UNAUTHORIZED_SUPER_ADMIN);
        }
    }
}

impl AdminContract {
    fn grant_role_internal(env: &Env, role: &Role, account: &Address) {
        let key = role_key(env, role, account);
        env.storage().persistent().set(&key, &true);
        env.storage().persistent().extend_ttl(&key, 100, 100);

        env.events().publish(
            (Symbol::new(env, "role_granted"), role.clone(), account.clone()),
            (),
        );
    }

    fn has_role_internal(env: &Env, role: &Role, account: &Address) -> bool {
        role_is_stored(env, role, account)
    }
}
