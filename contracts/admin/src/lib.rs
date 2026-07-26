#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Vec};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum Role {
    SuperAdmin,
    Minter,
    Pauser,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Role(Role, Address),
}

#[contract]
pub struct AdminContract;

impl AdminContract {
    fn admin(env: &Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::Admin)
    }

    fn role_key(role: Role, account: &Address) -> DataKey {
        DataKey::Role(role, account.clone())
    }

    fn role_is_granted(env: &Env, role: Role, account: &Address) -> bool {
        env.storage()
            .persistent()
            .get(&Self::role_key(role, account))
            .unwrap_or(false)
    }

    fn require_authorized_admin(env: &Env) -> Address {
        let admin = Self::admin(env).unwrap_or_else(|| panic!("Unauthorized"));
        admin.require_auth();
        admin
    }

    fn require_super_admin_internal(env: &Env, account: &Address) {
        let is_super_admin = Self::admin(env)
            .as_ref()
            .map(|admin| admin == account)
            .unwrap_or(false)
            || Self::role_is_granted(env, Role::SuperAdmin, account);

        if !is_super_admin {
            panic!("Unauthorized: super admin required");
        }

        account.require_auth();
    }
}

#[contractimpl]
impl AdminContract {
    /// Sets the contract administrator. The initial administrator may be set
    /// without an existing administrator; subsequent changes require the
    /// current administrator's authorization.
    pub fn set_admin(env: Env, admin: Address) {
        if let Some(current_admin) = Self::admin(&env) {
            current_admin.require_auth();
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.events().publish(
            (symbol_short!("admin"), symbol_short!("set")),
            admin,
        );
    }

    pub fn get_admin(env: Env) -> Address {
        Self::admin(&env).unwrap_or_else(|| panic!("Admin not initialized"))
    }

    pub fn has_admin(env: Env, account: Address) -> bool {
        Self::admin(&env)
            .map(|admin| admin == account)
            .unwrap_or(false)
    }

    pub fn grant_role(env: Env, role: Role, account: Address) {
        Self::require_authorized_admin(&env);
        env.storage()
            .persistent()
            .set(&Self::role_key(role, &account), &true);
        env.events().publish(
            (symbol_short!("role"), symbol_short!("grant")),
            (account, role),
        );
    }

    pub fn revoke_role(env: Env, role: Role, account: Address) {
        Self::require_authorized_admin(&env);
        env.storage()
            .persistent()
            .remove(&Self::role_key(role, &account));
        env.events().publish(
            (symbol_short!("role"), symbol_short!("revoke")),
            (account, role),
        );
    }

    pub fn has_role(env: Env, role: Role, account: Address) -> bool {
        let result = Self::has_role_without_event(&env, role, &account);
        env.events().publish(
            symbol_short!("role_chk"),
            (account, Vec::<Role>::from_array(&env, [role]), result),
        );
        result
    }

    fn has_role_without_event(env: &Env, role: Role, account: &Address) -> bool {
        Self::admin(env)
            .as_ref()
            .map(|admin| admin == account)
            .unwrap_or(false)
            || Self::role_is_granted(env, role, account)
    }

    pub fn require_role(env: Env, role: Role, account: Address) {
        if !Self::has_role_without_event(&env, role, &account) {
            panic!("Unauthorized: required role not held");
        }
    }

    pub fn require_role_guard(env: Env, role: Role, account: Address) {
        Self::require_role(env, role, account);
    }

    pub fn require_minter(env: Env, account: Address) {
        Self::require_role(env, Role::Minter, account);
    }

    /// Requires `account` to be either the configured administrator or an
    /// address explicitly holding the SuperAdmin role.
    ///
    /// The configured administrator implicitly holds every role, including
    /// SuperAdmin. Unlike the general role query, this guard performs only
    /// the authorization check and does not emit an event, minimizing the gas
    /// cost of modifier-style calls.
    pub fn require_super_admin(env: Env, account: Address) {
        Self::require_super_admin_internal(&env, &account);
    }
}
