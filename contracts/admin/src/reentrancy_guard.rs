use soroban_sdk::{Env, Symbol};

const GUARD_KEY: &str = "admin_proposal_guard";

pub(crate) struct GuardExit<'a> {
    env: &'a Env,
}

impl<'a> Drop for GuardExit<'a> {
    fn drop(&mut self) {
        self.env
            .storage()
            .persistent()
            .set(&Symbol::new(self.env, GUARD_KEY), &false);
    }
}

pub(crate) fn enter(env: &Env) -> GuardExit<'_> {
    let key = Symbol::new(env, GUARD_KEY);
    let entered = env
        .storage()
        .persistent()
        .get::<_, bool>(&key)
        .unwrap_or(false);
    assert!(
        !entered,
        "Reentrancy detected: admin proposal flow is active"
    );
    env.storage().persistent().set(&key, &true);
    GuardExit { env }
}
