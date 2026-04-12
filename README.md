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
│   └── token/                    # Core SEP-41 token contract
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs            # Token contract implementation
│           ├── events.rs         # Structured event emissions
│           └── test.rs           # Unit tests
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
cargo test --all
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
