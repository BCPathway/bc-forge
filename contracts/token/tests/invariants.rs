// SPDX-License-Identifier: MIT
//! Property-based invariant suite for the bc-forge token (#1347).
//!
//! Random operation sequences (mint, burn, transfer, lock, withdraw_locked,
//! set_max_supply, fee-enabled transfers) are applied through the public
//! client; after every step the invariants below are re-checked and any
//! violation reports the invariant name, the step index and the operation.
//!
//! Run: `cargo test -p bc-forge-token --test invariants`
//! Iterations: 500 by default, override with `PROPTEST_CASES`.

use bc_forge_token::{
    BcForgeToken, BcForgeTokenClient, DataKey, FeeConfig, LockupState, TokenError,
};
use proptest::prelude::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, Env, String};

const USERS: usize = 4;

#[derive(Clone, Debug)]
enum Op {
    Mint {
        to: usize,
        amount: i128,
    },
    Burn {
        from: usize,
        amount: i128,
    },
    Transfer {
        from: usize,
        to: usize,
        amount: i128,
    },
    Lock {
        user: usize,
        amount: i128,
        until: u64,
    },
    Withdraw {
        user: usize,
    },
    SetMax {
        max: i128,
    },
    Advance {
        secs: u64,
    },
}

fn op_strategy() -> impl Strategy<Value = Op> {
    let amt = 1i128..5_000;
    prop_oneof![
        (0..USERS, amt.clone()).prop_map(|(to, amount)| Op::Mint { to, amount }),
        (0..USERS, amt.clone()).prop_map(|(from, amount)| Op::Burn { from, amount }),
        (0..USERS, 0..USERS, amt.clone()).prop_map(|(from, to, amount)| Op::Transfer {
            from,
            to,
            amount
        }),
        (0..USERS, amt.clone(), 0u64..10_000).prop_map(|(user, amount, until)| Op::Lock {
            user,
            amount,
            until
        }),
        (0..USERS).prop_map(|user| Op::Withdraw { user }),
        (0i128..30_000).prop_map(|max| Op::SetMax { max }),
        (1u64..5_000).prop_map(|secs| Op::Advance { secs }),
    ]
}

struct Fixture<'a> {
    env: &'a Env,
    id: Address,
    client: BcForgeTokenClient<'a>,
    admin: Address,
    users: Vec<Address>,
    treasury: Address,
}

fn fixture(env: &Env, fees: bool) -> Fixture<'_> {
    env.mock_all_auths();
    let id = env.register(BcForgeToken, ());
    let client = BcForgeTokenClient::new(env, &id);
    let admin = Address::generate(env);
    client.initialize(
        &admin,
        &7,
        &String::from_str(env, "Invariant Token"),
        &String::from_str(env, "INV"),
    );
    // Admin mints draw on a per-minter budget (fixture_allowance).
    client.set_minter_allowance(&admin, &admin, &i128::MAX);
    let treasury = Address::generate(env);
    if fees {
        // The fee config normally goes through the privileged-action timelock;
        // write it directly so every transfer runs with fees enabled.
        env.as_contract(&id, || {
            env.storage().instance().set(
                &DataKey::FeeConfig,
                &FeeConfig {
                    base_fee: 3,
                    complexity_multiplier: 2,
                    max_fee: 50,
                    enabled: true,
                },
            );
            env.storage().instance().set(&DataKey::Treasury, &treasury);
        });
    }
    let users = (0..USERS).map(|_| Address::generate(env)).collect();
    Fixture {
        env,
        id,
        client,
        admin,
        users,
        treasury,
    }
}

impl Fixture<'_> {
    fn holders(&self) -> Vec<Address> {
        let mut v = self.users.clone();
        v.push(self.treasury.clone());
        v.push(self.admin.clone());
        v
    }

    fn locked(&self, user: &Address) -> i128 {
        self.env.as_contract(&self.id, || {
            self.env
                .storage()
                .persistent()
                .get::<_, LockupState>(&DataKey::Lockup(user.clone()))
                .map(|s| s.amount)
                .unwrap_or(0)
        })
    }

    fn apply(&self, op: &Op) {
        let c = &self.client;
        match op.clone() {
            Op::Mint { to, amount } => {
                let _ = c.try_mint(&self.admin, &self.users[to], &amount);
            }
            Op::Burn { from, amount } => {
                let _ = c.try_burn(&self.users[from], &amount);
            }
            Op::Transfer { from, to, amount } => {
                let _ = c.try_transfer(&self.users[from], &self.users[to], &amount);
            }
            Op::Lock {
                user,
                amount,
                until,
            } => {
                let now = self.env.ledger().timestamp();
                let _ = c.try_lock_tokens(&self.admin, &self.users[user], &amount, &(now + until));
            }
            Op::Withdraw { user } => {
                let _ = c.try_withdraw_locked(&self.users[user]);
            }
            Op::SetMax { max } => {
                let _ = c.try_set_max_supply(&self.admin, &max);
            }
            Op::Advance { secs } => {
                let now = self.env.ledger().timestamp();
                self.env.ledger().set_timestamp(now + secs);
            }
        }
    }

    /// Returns the name of the first violated invariant, with details.
    fn check(&self, probe: bool) -> Result<(), String2> {
        let supply = self.client.supply();
        let sum: i128 = self.holders().iter().map(|u| self.client.balance(u)).sum();
        if supply != sum {
            return Err(format!(
                "supply conservation: total_supply={supply} != sum(balances)={sum}"
            ));
        }
        for u in &self.users {
            let total = self.client.balance(u);
            let locked = self.locked(u);
            let spendable = total - locked;
            if locked < 0 || spendable < 0 || spendable + locked != total {
                return Err(format!(
                    "lockup balance: spendable={spendable} + locked={locked} != total={total}"
                ));
            }
            // Spendable is really spendable and one more unit is not.
            if probe && spendable > 0 && total > 0 {
                let sink = Address::generate(self.env);
                if self.client.try_transfer(u, &sink, &(spendable + 1)).is_ok() {
                    return Err(format!(
                        "lockup balance: transferred more than spendable={spendable}"
                    ));
                }
            }
        }
        Ok(())
    }
}

type String2 = std::string::String;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(
        std::env::var("PROPTEST_CASES").ok().and_then(|v| v.parse().ok()).unwrap_or(500)
    ))]

    /// Invariants 1-3: supply conservation, lockup balance, max supply ceiling.
    #[test]
    fn supply_lockup_and_ceiling_hold(ops in proptest::collection::vec(op_strategy(), 1..15)) {
        let env = Env::default();
        let f = fixture(&env, false);
        let mut max = i128::MAX;
        for (i, op) in ops.iter().enumerate() {
            let before = f.client.supply();
            f.apply(op);
            if let Op::SetMax { max: m } = op {
                max = *m;
            }
            let after = f.client.supply();
            if matches!(op, Op::Mint { .. }) && after > before && after > max {
                prop_assert!(false, "INVARIANT VIOLATED at step {i} after {op:?}: max supply ceiling: supply={after} > max_supply={max}");
            }
            if let Err(e) = f.check(i + 1 == ops.len()) {
                prop_assert!(false, "INVARIANT VIOLATED at step {i} after {op:?}: {e}");
            }
        }
    }

    /// Invariant 3 (strict): minting can never push supply past the ceiling.
    #[test]
    fn mint_never_exceeds_max_supply(max in 1i128..10_000, mints in proptest::collection::vec(1i128..4_000, 1..15)) {
        let env = Env::default();
        let f = fixture(&env, false);
        f.client.set_max_supply(&f.admin, &max);
        for (i, amount) in mints.iter().enumerate() {
            let _ = f.client.try_mint(&f.admin, &f.users[i % USERS], amount);
            prop_assert!(f.client.supply() <= max, "INVARIANT VIOLATED: supply {} > max_supply {max} at mint #{i}", f.client.supply());
        }
    }

    /// Invariant 4: transfers with fees enabled never change circulating supply.
    #[test]
    fn fee_config_never_inflates_supply(ops in proptest::collection::vec(op_strategy(), 1..15)) {
        let env = Env::default();
        let f = fixture(&env, true);
        for (i, op) in ops.iter().enumerate() {
            let before = f.client.supply();
            f.apply(op);
            let after = f.client.supply();
            let expected_max = match op {
                Op::Mint { .. } => before + match op { Op::Mint { amount, .. } => *amount, _ => 0 },
                _ => before,
            };
            prop_assert!(after <= expected_max, "INVARIANT VIOLATED (fee neutrality) at step {i} after {op:?}: supply {before} -> {after}");
            if matches!(op, Op::Transfer { .. }) {
                prop_assert_eq!(before, after, "transfer changed supply at step {}", i);
            }
            if let Err(e) = f.check(i + 1 == ops.len()) {
                prop_assert!(false, "INVARIANT VIOLATED at step {i} after {op:?}: {e}");
            }
        }
    }

    /// Invariant 5: rescue_tokens cannot touch the token's own supply or balances.
    #[test]
    fn rescue_cannot_move_own_supply(amount in 1i128..5_000, stranded in 1i128..5_000) {
        let env = Env::default();
        let f = fixture(&env, false);
        f.client.mint(&f.admin, &f.users[0], &amount);

        // A separate "stranded" token whose units sit in the main token contract.
        let other_id = env.register(BcForgeToken, ());
        let other = BcForgeTokenClient::new(&env, &other_id);
        other.initialize(&f.admin, &7, &String::from_str(&env, "Other"), &String::from_str(&env, "OTH"));
        other.set_minter_allowance(&f.admin, &f.admin, &i128::MAX);
        other.mint(&f.admin, &f.id, &stranded);

        let supply = f.client.supply();
        let bal0 = f.client.balance(&f.users[0]);
        let own_bal = f.client.balance(&f.id);

        // Rescuing the token's own asset is rejected and changes nothing.
        let res = f.client.try_rescue_tokens(&f.admin, &f.id, &f.users[1], &1);
        prop_assert_eq!(res, Err(Ok(TokenError::UnknownToken)));
        prop_assert_eq!(f.client.supply(), supply);
        prop_assert_eq!(f.client.balance(&f.users[0]), bal0);
        prop_assert_eq!(f.client.balance(&f.id), own_bal);

        // Rescuing a foreign token moves only that token.
        f.client.rescue_tokens(&f.admin, &other_id, &f.users[1], &stranded);
        prop_assert_eq!(other.balance(&f.users[1]), stranded);
        prop_assert_eq!(f.client.supply(), supply);
        prop_assert_eq!(f.client.balance(&f.users[0]), bal0);
        prop_assert_eq!(f.client.balance(&f.id), own_bal);
        prop_assert_eq!(other.supply(), stranded);
    }
}
