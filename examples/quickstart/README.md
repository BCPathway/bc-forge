# bc-forge Quickstart dApp

A minimal testnet dApp demonstrating how to use the **bc-forge SDK**, **React hooks**, and **Indexer API** together.

## Features

- 🔗 Connect wallet (Freighter)
- 📊 Display token info (name, symbol, decimals)
- 💰 Show wallet balance
- 📜 Fetch and display recent mints from the indexer

## Prerequisites

- Node.js 18+
- A deployed bc-forge token contract on testnet
- (Optional) An indexer instance running for the contract

## Quick Start

### 1. Install Dependencies

```bash
cd examples/quickstart
npm install
```

### 2. Configure

Edit the configuration in the app UI or set environment variables:

| Setting | Description | Example |
|---------|-------------|---------|
| **Contract ID** | Your deployed token contract ID | `CABC...XYZ` |
| **RPC URL** | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| **Network Passphrase** | Stellar network passphrase | `Test SDF Network ; September 2015` |
| **Indexer Base URL** | Your indexer API base URL | `https://indexer.example.com` |
| **Indexer API Token** | Bearer token for authenticated indexer (optional) | `your-secret-token` |

### 3. Run Development Server

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

### 4. Build for Production

```bash
npm run build
```

The production build will be in the `dist/` directory.

## Deploying a Testnet Token

If you don't have a token contract deployed yet:

```bash
# From the repository root
cd /path/to/bc-forge

# Build the contracts
cargo build --target wasm32-unknown-unknown --release

# Deploy to testnet
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/bc_forge_token.wasm \
  --source deployer \
  --network testnet

# Save the returned Contract ID

# Initialize the token
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin_address <YOUR_PUBLIC_KEY> \
  --decimal 7 \
  --name "bc-forge Token" \
  --symbol "SFG"
```

`initialize` takes `admin_address`, `decimal`, `name`, and `symbol`. The token contract does not expose `grant_role`.

## Running the Indexer

The indexer provides the `/api/v1/mints` endpoint used by this dApp.

```bash
cd /path/to/bc-forge/indexer

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, INDEXER_API_TOKEN, etc.

# Install dependencies
npm install

# Run database migrations
npx prisma migrate deploy

# Start the indexer
npm run dev
```

The indexer will be available at `http://localhost:3000` by default.

## Project Structure

```
examples/quickstart/
├── index.html          # HTML entry point
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── tsconfig.node.json  # TypeScript config for Vite
├── vite.config.ts      # Vite configuration
└── src/
    ├── main.tsx        # React entry point
    ├── App.tsx         # Main app component
    ├── index.css       # Styles
    └── vite-env.d.ts   # Vite type declarations
```

## Key Technologies

- **@bc-forge/sdk** - TypeScript SDK for contract interactions
- **@bc-forge/react** - React hooks and context for the SDK
- **@stellar/stellar-sdk** - Stellar JavaScript SDK
- **Vite** - Build tool and dev server
- **React 18** - UI framework
- **TypeScript** - Type safety

## Configuration Details

Configuration lives in the React state in `src/App.tsx`. Change it in the form on the page, or edit the default values in that file. The indexer base URL is the server origin only. The app requests `${indexerUrl}/api/v1/mints` itself.

For production deployments, consider using environment variables and a proper configuration system.

## Troubleshooting

### "Failed to connect wallet"
- Ensure Freighter extension is installed
- Check that the network in Freighter matches (testnet)
- Verify the contract ID is correct

### "Failed to fetch mints"
- Ensure the indexer is running and accessible
- Use the indexer origin only, such as `http://localhost:3000`. The app appends `/api/v1/mints`
- If using authentication, verify the API token is correct
- Check CORS settings on the indexer

### Balance shows 0
- The address may not have any tokens
- Mint some tokens using the CLI or another admin tool

## License

MIT — Free for personal and commercial use.