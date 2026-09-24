# [bc-forge] React package skeletal; indexer lags contract events; no e2e/deploy CI job

**Label:** `bugs`

## Description

Three related gaps in the consumer-facing and release tooling layers of the bc-forge monorepo:

1. **React package is skeletal.** The workspace contains a React package, but it provides essentially no usable components or hooks — it's scaffolding without substance. Consumers wanting UI primitives for token/vesting/split flows have nothing to import.

2. **Indexer lags the contract event surface.** The Prisma + Express indexer does not subscribe to / persist all events emitted by the contracts. As new events were added to lifecycle, vesting, split, rate-limit, etc., the indexer was not kept in sync, so downstream queries silently return incomplete data.

3. **No e2e or deploy job in CI.** GitHub Actions currently runs fmt, clippy, test, coverage, and WASM build — but there is no end-to-end job (deploy to testnet + smoke-test against a live contract) and no release/deploy pipeline. Regressions that only manifest against a real Soroban network go undetected until manual testing.

## Impact

- UI consumers blocked / forced to hand-roll integrations against the raw SDK.
- Indexer data is untrustworthy for any feature whose events were added after the indexer's last sync.
- "It compiles and unit-tests pass" no longer means "it works on-chain." Release confidence is low.

## Proposed Fix

### React package
- Audit what integration flows are most common (token balance, transfer, vesting claim, split recipient view).
- Ship at minimum: typed hooks wrapping the SDK (`useTokenBalance`, `useVestingSchedule`, etc.) and headless component primitives.
- Document usage in Storybook or equivalent.

### Indexer
- Enumerate every event emitted across all contracts (grep `env.events().publish` / equivalent).
- Add a parity test that fails CI if a contract emits an event type the indexer doesn't handle.
- Backfill handler logic for any missing events.

### CI
- Add an `e2e` job: build WASM → deploy to Soroban testnet via the CLI's deploy command → run the existing smoke-test command → tear down.
- Add a `release` job gated on tag push that publishes crates / npm packages and uploads artifacts.

## Context

Identified during a full codebase scan of the bc-forge monorepo (TS workspaces: sdk with 3 wallet adapters, cli with deploy/upgrade/smoke-test commands, prisma+express indexer, skeletal react package; GitHub Actions CI with fmt/clippy/test/coverage/WASM build).
