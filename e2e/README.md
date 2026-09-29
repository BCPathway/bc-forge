# bc-forge End-to-End Integration Tests

This directory holds the **offline** end-to-end integration tests for the
bc-forge token and wrapper contracts, packaged as the `bc-forge-e2e-tests`
crate. They run against `soroban_sdk`'s in-process test host
(`Env::default()` with mocked auth), so they are deterministic and never touch
a network. Pull-request CI runs them via `cargo test --all`.

Live **Stellar testnet** coverage lives elsewhere: the nightly
[`Nightly E2E (Testnet)`](#nightly-testnet-workflow) workflow deploys the token
contract to testnet and drives it with funded accounts through the CLI's live
suite, [`cli/src/__tests__/e2e-testnet.test.ts`](../cli/src/__tests__/e2e-testnet.test.ts).

> The Soroban test host is in-process and cannot reach testnet, so the Rust
> crate here is intentionally mock-only. There is no `STELLAR_TESTNET_*`
> switch for it.

## Prerequisites

- Rust 1.74+ with the `wasm32-unknown-unknown` target
- Stellar CLI 22.0+ (for the live testnet suite — see [CONTRIBUTING.md](../CONTRIBUTING.md))
- Node.js 18+ (for the live testnet suite)
- `curl` (friendbot funding and RPC health checks)

## Running Tests

### Offline suite (default)

```bash
cargo test -p bc-forge-e2e-tests
```

Or from this directory:

```bash
cd e2e
cargo test
```

### Live testnet suite (opt-in)

The live suite is skipped unless it is explicitly enabled and given a deployed
testnet token contract it administers:

```bash
# Create and friendbot-fund a throwaway testnet identity
stellar keys generate e2e-local --network testnet --fund

# Deploy and initialize the token contract (see the nightly workflow for the
# exact commands), then export the endpoint/credentials the live suite reads.
export RUN_E2E_TESTNET=true
export E2E_TESTNET_RPC_URL=https://soroban-testnet.stellar.org
export E2E_TESTNET_PASSPHRASE="Test SDF Network ; September 2015"
export E2E_TESTNET_SECRET="$(stellar keys show e2e-local)"
export E2E_TOKEN_CONTRACT_ID=C...

# Run just the live suite
cd cli
npm test -- e2e-testnet
```

## Test Coverage (offline suite)

- Complete token lifecycle (deploy → init → mint → transfer → verify)
- Token → vault → compound yield lifecycle (#740)
- Parallel execution
- Deployment verification

## Nightly (Testnet) Workflow

[`.github/workflows/e2e-nightly.yml`](../.github/workflows/e2e-nightly.yml)
runs the **live** suite against Stellar testnet nightly.

| Property | Value |
| --- | --- |
| Workflow | `Nightly E2E (Testnet)` (`e2e-nightly.yml`) |
| Trigger | `schedule` — nightly at `02:00 UTC` (`0 2 * * *`); plus manual `workflow_dispatch` |
| Job | `e2e-testnet` (single job, `ubuntu-latest`, 60-minute timeout) |
| Toolchain | Rust `1.96.0` + `wasm32-unknown-unknown`; Stellar CLI `22.0.0`+; Node.js `22` |
| Network | `https://soroban-testnet.stellar.org` (`Test SDF Network ; September 2015`) |
| Funding | Friendbot (`https://friendbot.stellar.org`) |
| Suite | `npm test -- e2e-testnet` in `cli/` (live testnet e2e, #708) |

### What it does

1. Installs the pinned Rust toolchain (with the `wasm32-unknown-unknown` target),
   Stellar CLI and Node.js, and restores the dedicated `bc-forge-e2e-nightly`
   Rust cache.
2. Checks that the testnet Soroban RPC is reachable (`getLatestLedger`).
3. Generates one throwaway identity, funds it with friendbot, and waits until
   Horizon reports the account. The secret is registered with `::add-mask::` so
   it never appears in logs.
4. Builds the token contract WASM, deploys a fresh instance to testnet with the
   funded account, and calls `initialize` with that account as admin.
5. Runs the live e2e suite (`cli/src/__tests__/e2e-testnet.test.ts`), which mints
   and transfers tokens on the deployed contract, teeing output to
   `e2e-nightly.log`.
6. Uploads `e2e-nightly.log` (and the RPC health JSON) as the
   `e2e-nightly-logs-<run_id>` artifact **on failure**, retained for 14 days.

### Why it is not part of pull-request CI

Pull requests must stay fast and must not depend on the public testnet being up
or on funded accounts. The workflow only subscribes to `schedule` and
`workflow_dispatch`, so `pull_request` CI never waits on it and it is not a
required status check. It is also cached under a separate key so a nightly run
cannot evict PR caches.
