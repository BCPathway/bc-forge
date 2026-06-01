# bc-forge 🔨

A modular Soroban smart contract platform for **token minting** on the Stellar blockchain, with a TypeScript SDK for seamless integration.

Built for open-source collaboration via [drips.network](https://www.drips.network).

---

## ✨ Features

- **SEP-41 Compliant Token** — Full `TokenInterface` implementation (balance, transfer, approve, burn)
- **Admin-Controlled Minting** — Only the contract admin can mint new tokens
- **Pausable Lifecycle** — Emergency pause/unpause to halt all operations
- **Ownership Transfer** — Securely hand over admin rights
- **Total Supply Tracking** — Accurate supply updated on every mint/burn
- **TypeScript SDK** — High-level client for all contract interactions
- **Modular Architecture** — Separate crates for admin, lifecycle, and token logic
- **Reentrancy Protection** — Comprehensive reentrancy guards for all state-modifying functions
- **Rate Limiting** — Configurable global and per-address rate limits for mint and transfer operations
- **Property-Based Fuzz Testing** — Enhanced proptest framework for invariant verification
- **End-to-End Integration Tests** — Complete lifecycle testing on Stellar testnet
- **Automatic Storage TTL Management** — Shared helper module extends Soroban contract and persistent storage TTL across calls

## 📁 Project Structure

```
bc-forge/
├── contracts/                    # Soroban smart contracts (Rust)
│   ├── admin/                    # Admin access control module
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── lifecycle/                # Pause/unpause lifecycle module
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   ├── rate-limit/             # Rate limiting module
│   ├── ttl/                      # Shared storage TTL helpers
│   │   ├── Cargo.toml
│   │   └── src/lib.rs
│   └── token/                    # Core SEP-41 token contract
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs            # Token contract implementation
│           ├── events.rs         # Structured event emissions
│           ├── proptest.rs       # Property-based fuzz testing
│           ├── reentrancy_guard.rs # Reentrancy protection
│           ├── rate_limit.rs     # Rate limit integration
│           └── test.rs           # Unit tests
├── e2e/                          # End-to-end integration tests
│   ├── Cargo.toml              # E2E test dependencies
│   ├── integration_test.rs     # Integration test suite
│   └── README.md               # E2E test documentation
├── sdk/                          # TypeScript SDK
│   ├── src/
│   │   ├── index.ts              # Entry point
│   │   ├── client.ts             # bcForgeClient class
│   │   └── utils.ts              # Transaction helpers
│   ├── package.json
│   └── tsconfig.json
├── .github/
│   ├── ISSUE_TEMPLATE/           # Bug, Feature, Contract Improvement
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/ci.yml         # CI pipeline
├── Cargo.toml                    # Workspace manifest
├── CONTRIBUTING.md               # Contributor guide (drips.network)
├── LICENSE                       # MIT
└── README.md                     # This file
```

## 🧠 Storage TTL Strategy

To keep Soroban contract state active, bc-forge now includes shared TTL logic that:

- extends the contract instance TTL on every public token, admin, and lifecycle call
- refreshes persistent storage TTL for balances, allowances, lockups, roles, and proposals
- treats expired balances and allowances as zero instead of panicking

This makes the system more resilient to Soroban storage expiry while preserving on-chain security semantics.

## 🛠️ Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| **Rust** | 1.74+ | [rustup.rs](https://rustup.rs) |
| **Wasm target** | — | `rustup target add wasm32-unknown-unknown` |
| **Stellar CLI** | 22.0+ | `cargo install stellar-cli --locked` |
| **Node.js** | 18+ | [nodejs.org](https://nodejs.org) |

## 🚀 Local Setup

### 1. Clone the Repository

```bash
git clone https://github.com/p3ris0n/bc-forge.git
cd bc-forge
```

### 2. Install Rust & Soroban Tooling

```bash
# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add the WebAssembly target
rustup target add wasm32-unknown-unknown

# Install Stellar CLI (includes Soroban)
cargo install stellar-cli --locked
```

### 3. Build the Smart Contracts

```bash
# Build all contracts (debug)
cargo build

# Build optimized WASM for deployment
cargo build --target wasm32-unknown-unknown --release

# Or use Stellar CLI
stellar contract build
```

### 4. Run Contract Tests

```bash
cargo test --tests
```

Expected output:
```
running 5 tests (admin)     ... ok
running 5 tests (lifecycle) ... ok
running 16 tests (token)    ... ok
```

### 5. Setup the TypeScript SDK

```bash
cd sdk
npm install
npm run build
```

## 🌐 Deploy to Testnet

### Generate a Keypair

```bash
stellar keys generate --global deployer --network testnet
```

### Fund the Account

```bash
stellar keys fund deployer --network testnet
```

### Deploy the Token Contract

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --source deployer \
  --network testnet
```

Save the returned **Contract ID** (e.g., `CABC...XYZ`).

### Initialize the Token

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin <YOUR_PUBLIC_KEY> \
  --decimal 7 \
  --name "bc-forge Token" \
  --symbol "SFG"
```

### Mint Tokens

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  mint \
  --to <RECIPIENT_ADDRESS> \
  --amount 10000000000
```

### Check Balance

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  -- \
  balance \
  --id <ADDRESS>
```

## 🧪 Local Development with Quickstart

If you want to build and test against a local Soroban network, run the Stellar Quickstart container instead of using public testnet services.

### Start Quickstart

```bash
docker run -d \
  -p "8000:8000" \
  --name stellar \
  stellar/quickstart \
  --local
```

This starts a local Stellar network with RPC, Horizon, and Friendbot on your machine.

### Configure the CLI for the Local Network

Register the local network once, then switch the CLI to it:

```bash
stellar network add local \
  --rpc-url http://localhost:8000/rpc \
  --network-passphrase "Test SDF Network ; September 2015"

stellar network use local
```

### Generate and Fund Accounts

Create a local identity and fund it from the local Friendbot instance:

```bash
stellar keys generate deployer
stellar keys fund deployer
```

You can use `stellar keys public-key deployer` to print the address, then use that keypair as the source account for contract deploy and invoke commands on the local network.

### Point the TypeScript SDK at Quickstart

When using `bcForgeClient`, point `rpcUrl` at the local Quickstart instance:

```typescript
import { bcForgeClient } from '@bc-forge/sdk';

const client = new bcForgeClient({
  rpcUrl: 'http://localhost:8000',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CABC...XYZ',
});
```

If your local Quickstart setup exposes RPC on a different path, keep the same host and update the URL to match your container configuration.

## 📦 SDK Usage

```typescript
import { bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';

const client = new bcForgeClient({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CABC...XYZ',
});

// Query balance
const balance = await client.getBalance('GABC...DEF');
console.log('Balance:', balance.toString());

// Mint tokens (admin only)
const admin = Keypair.fromSecret('SXXX...');
await client.mint('GABC...DEF', BigInt(1000_0000000), admin);

// Transfer tokens
const sender = Keypair.fromSecret('SYYY...');
await client.transfer(
  sender.publicKey(),
  'GXYZ...ABC',
  BigInt(100_0000000),
  sender
);
```

See [sdk/README.md](sdk/README.md) for the full API reference.

## 🏗️ Smart Contract Architecture

```
┌─────────────────────────────────────────────────┐
│                  BcForgeToken                   │
│  ┌───────────┐  ┌──────────────┐  ┌───────────┐│
│  │   Admin    │  │  Lifecycle   │  │  SEP-41   ││
│  │  Module    │  │   Module     │  │ Interface ││
│  │           │  │              │  │           ││
│  │ set_admin │  │ pause()      │  │ balance() ││
│  │ get_admin │  │ unpause()    │  │ transfer()││
│  │ require_  │  │ is_paused()  │  │ approve() ││
│  │   admin() │  │ require_not_ │  │ burn()    ││
│  │           │  │   paused()   │  │ mint()    ││
│  └───────────┘  └──────────────┘  └───────────┘│
└─────────────────────────────────────────────────┘
```

## 🤝 Contributing

We welcome contributions! bc-forge is maintained on [drips.network](https://www.drips.network) — contributors can earn rewards by resolving posted issues.

### Quick Start for Contributors

1. **Browse open issues** — Look for issues labeled `good-first-issue`, `smart-contract`, or `sdk`
2. **Fork & branch** — Create a branch: `feature/<issue-number>-<short-description>`
3. **Implement & test** — Write code, add/update tests, ensure `cargo test` and `npm run build` pass
4. **Submit a PR** — Use the PR template; reference the issue number

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

### Branch Naming Convention

```
feature/<issue-number>-<description>     # New features
fix/<issue-number>-<description>         # Bug fixes
docs/<issue-number>-<description>        # Documentation
test/<issue-number>-<description>        # Test improvements
```

## 📄 License

[MIT](LICENSE) — Free for personal and commercial use.

## 🔗 Links

- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar SDK (JS)](https://github.com/stellar/js-stellar-sdk)
- [SEP-41 Token Standard](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
- [drips.network](https://www.drips.network)
