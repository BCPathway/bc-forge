---
title: Building Your First Soroban Token dApp
description: Learn how to deploy a Soroban token contract, interact with it using the BC Forge SDK, and build a React frontend.
---

# Building Your First Soroban Token dApp

In this tutorial, you will build a simple token decentralized application (dApp) using the BC Forge ecosystem.

You will learn how to:

- Configure a Soroban testnet project using the BC Forge CLI.
- Deploy and initialize a token contract.
- Interact with your token using `@bc-forge/sdk`.
- Integrate BC Forge React components and hooks into a frontend.
- Read token balances and supply.
- Perform basic token operations.
- Verify that your application is connected to the correct contract and network.

By the end of this tutorial, you will have the foundations of a token dApp with a smart contract, a TypeScript SDK integration, and a React user interface.

## Architecture

The application consists of three main layers:

| Layer | Package | Responsibility |
|---|---|---|
| Smart contract | Soroban | Stores token state and executes token operations |
| SDK | `@bc-forge/sdk` | Provides a TypeScript interface for interacting with the contract |
| Frontend | `@bc-forge/react` | Provides React integration, hooks, and UI components |

The frontend communicates with the contract through the SDK. Transactions requiring authorization are signed by the user's wallet rather than exposing secret keys in the frontend.

## Prerequisites

Before proceeding, ensure you have the following installed:

- Node.js (LTS)
- npm
- Rust toolchain
- Stellar CLI with Soroban contract support
- A Stellar wallet such as Freighter
- A Stellar testnet account funded with test XLM
- Basic knowledge of TypeScript, React, and smart contracts

You should also have a basic understanding of public keys, secret keys, and blockchain transactions.

> This tutorial uses Stellar Testnet. Do not use production wallets, private keys, or real funds while learning.

## 1. Create your project

Create a directory for your project:

```bash
mkdir my-token-dapp
cd my-token-dapp
```

Initialize a Node.js project:

```bash
npm init -y
```

Install the BC Forge CLI:

```bash
npm install --save-dev @bc-forge/cli
```

You can run the CLI through your local installation using `npx`.

Check that it is available:

```bash
npx bc-forge --help
```

If the CLI binary is not available under that command, consult the installed package's binary mapping and use the documented entrypoint.

## 2. Configure your token project

The BC Forge CLI provides an initialization command that allows you to configure your token project.

Run:

```bash
npx bc-forge init
```

The CLI will guide you through the configuration process.

For a non-interactive configuration, you can specify the required values:

```bash
npx bc-forge init 
  --network testnet 
  --rpc-url https://soroban-testnet.stellar.org 
  --admin YOUR_ADMIN_PUBLIC_KEY 
  --name "My First Token" 
  --symbol MFT 
  --decimals 7 
  --initial-supply 1000000
```

Replace `YOUR_ADMIN_PUBLIC_KEY` with the public key of your funded testnet account.

### Configuration options

| Option | Description |
|---|---|
| `--network` | Target network, such as testnet |
| `--rpc-url` | Soroban RPC endpoint |
| `--admin` | Administrator public key |
| `--name` | Token name |
| `--symbol` | Token symbol |
| `--decimals` | Token precision |
| `--initial-supply` | Initial token supply |

The command generates a project configuration file containing public configuration information.

Example configuration:

```json
{
  "network": "testnet",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "admin": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "name": "My First Token",
  "symbol": "MFT",
  "decimals": 7,
  "initialSupply": "1000000"
}
```

The configuration contains public information only. Do not store secret keys in this file.

## 3. Prepare your administrator account

The administrator account is used for privileged operations such as initial setup or minting, depending on the contract's access-control rules.

Ensure that:

1. You have a Stellar Testnet account.
2. The account has been funded with test XLM.
3. You have access to the account's secret key securely.
4. You have verified that the account's public key matches the configured administrator address.

You can obtain testnet XLM through a Stellar testnet funding service.

### Environment variables

For local development, you may use environment variables to supply sensitive values to trusted scripts.

Create a local `.env` file:

```env
RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015
SECRET_KEY=YOUR_ADMIN_SECRET_KEY
```

Add `.env` to your `.gitignore` file:

```gitignore
.env
.env.local
```

Never commit secret keys to Git.

## 4. Deploy your token contract

The BC Forge CLI provides contract deployment and orchestration capabilities.

Before deployment, inspect the deployment command available in your installed CLI version:

```bash
npx bc-forge --help
```

Then inspect the deployment-related command help:

```bash
npx bc-forge orchestrate --help
```

Use the deployment workflow documented by your installed CLI version to deploy the token WASM artifact and initialize the contract.

Deployment generally requires:

- The compiled contract WASM artifact.
- A funded deployer account.
- The target RPC endpoint.
- The network passphrase.
- The token's initialization parameters.

> CLI command flags may vary between versions. Always use the command help for the installed version rather than copying flags from a different release.

After a successful deployment, record the contract ID.

Example:

```text
Token Contract ID:
CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

You will use this contract ID when connecting the SDK and frontend.

### Verify deployment

Use the BC Forge CLI status command to check whether your deployed contract is reachable:

```bash
npx bc-forge check-status
```

If your deployment configuration is stored in a custom file:

```bash
npx bc-forge check-status --config ./config.example.json
```

The CLI reports the contract's reachability status.

## 5. Install the BC Forge SDK

The SDK provides a TypeScript interface for interacting with BC Forge token contracts.

Install the package:

```bash
npm install @bc-forge/sdk
```

The SDK can be used to read token information and perform supported token operations.

## 6. Connect to your token contract

Create a file named `src/token-client.ts`.

```typescript
import { bcForgeClient } from '@bc-forge/sdk';

export const tokenClient = new bcForgeClient({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'YOUR_DEPLOYED_TOKEN_CONTRACT_ID',
});
```

Replace `YOUR_DEPLOYED_TOKEN_CONTRACT_ID` with the contract ID obtained during deployment.

This client is now configured to communicate with the deployed token contract.

## 7. Read token metadata

Token metadata provides information about the token, including its name, symbol, decimal precision, and total supply.

Create a script to read the token metadata.

```typescript
import { tokenClient } from './token-client';

async function readTokenMetadata() {
  const name = await tokenClient.getName();
  const symbol = await tokenClient.getSymbol();
  const decimals = await tokenClient.getDecimals();
  const totalSupply = await tokenClient.getTotalSupply();

  console.log('Token name:', name);
  console.log('Token symbol:', symbol);
  console.log('Token decimals:', decimals);
  console.log('Total supply:', totalSupply.toString());
}

readTokenMetadata().catch(console.error);
```

Expected output will depend on your token configuration:

```text
Token name: My First Token
Token symbol: MFT
Token decimals: 7
Total supply: ...
```

This demonstrates how to retrieve token information through the SDK without manually constructing Soroban contract calls.

## 8. Query a token balance

You can use the SDK to query the balance of a Stellar account.

```typescript
import { tokenClient } from './token-client';

async function getTokenBalance(address: string) {
  const balance = await tokenClient.getBalance(address);

  console.log('Balance:', balance.toString());
}

getTokenBalance('GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
  .catch(console.error);
```

Replace the example address with the public key of the account you want to query.

A balance query is read-only and does not require the user to authorize a transaction.

## 9. Perform token operations

Token contracts commonly support operations such as minting, transferring, and burning tokens.

These operations may require authorization from the account permitted by the contract's rules.

### Mint tokens

Minting creates new tokens and assigns them to a recipient.

```typescript
import { Keypair } from '@stellar/stellar-sdk';
import { tokenClient } from './token-client';

async function mintTokens() {
  const adminKeypair = Keypair.fromSecret(
    process.env.SECRET_KEY!,
  );

  const result = await tokenClient.mint(
    'RECIPIENT_PUBLIC_KEY',
    BigInt(10 * 10 ** 7),
    adminKeypair,
  );

  console.log('Mint transaction:', result.hash);
}

mintTokens().catch(console.error);
```

The example amount represents 10 tokens when the token uses seven decimal places.

> Minting is an administrative operation. The administrator secret key must remain in a trusted environment and must never be included in browser code.

### Transfer tokens

Transfers move tokens from one account to another, subject to the token contract's authorization rules.

```typescript
import { Keypair } from '@stellar/stellar-sdk';
import { tokenClient } from './token-client';

async function transferTokens() {
  const senderKeypair = Keypair.fromSecret(
    process.env.SECRET_KEY!,
  );

  const result = await tokenClient.transfer(
    senderKeypair.publicKey(),
    'RECIPIENT_PUBLIC_KEY',
    BigInt(5 * 10 ** 7),
    senderKeypair,
  );

  console.log('Transfer transaction:', result.hash);
}

transferTokens().catch(console.error);
```

This example demonstrates the SDK transfer flow. In a production frontend, the sender should authorize the transaction through a wallet rather than exposing a secret key.

### Burn tokens

Burning removes tokens from circulation.

```typescript
import { Keypair } from '@stellar/stellar-sdk';
import { tokenClient } from './token-client';

async function burnTokens() {
  const account = Keypair.fromSecret(
    process.env.SECRET_KEY!,
  );

  const result = await tokenClient.burn(
    account.publicKey(),
    BigInt(1 * 10 ** 7),
    account,
  );

  console.log('Burn transaction:', result.hash);
}

burnTokens().catch(console.error);
```

The burn operation removes one token, assuming seven decimal places.

The actual authorization and parameter requirements are determined by the deployed contract and SDK version.

## 10. Create a React frontend

Now that the contract is deployed and the SDK is configured, you can build a frontend to interact with the token.

Create a React application with Vite:

```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install
```

Install the BC Forge React package:

```bash
npm install @bc-forge/react
```

The React package provides provider-based integration and hooks for accessing BC Forge functionality.

## 11. Configure the React provider

Create or update `src/App.tsx`.

```tsx
import {
  BcForgeProvider,
  useBalance,
  useTotalSupply,
} from '@bc-forge/react';

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: import.meta.env.VITE_TOKEN_CONTRACT_ID,
};

function TokenDashboard() {
  const [address, setAddress] = React.useState('');

  const { data: balance, loading, error } = useBalance(address);
  const { data: totalSupply } = useTotalSupply();

  return (
    <main className="container">
      <h1>My First Token dApp</h1>

      <label htmlFor="wallet-address">Wallet public key</label>

      <input
        id="wallet-address"
        value={address}
        onChange={(event) => setAddress(event.target.value.trim())}
        placeholder="Enter a Stellar public key"
      />

      <section>
        <h2>Your balance</h2>

        {loading && <p>Loading balance...</p>}

        {error && (
          <p role="alert">
            Failed to load balance: {error.message}
          </p>
        )}

        {!loading && !error && (
          <p>{balance?.toString() ?? '—'}</p>
        )}
      </section>

      <section>
        <h2>Total supply</h2>
        <p>{totalSupply?.toString() ?? '—'}</p>
      </section>
    </main>
  );
}

function App() {
  return (
    <BcForgeProvider config={config}>
      <TokenDashboard />
    </BcForgeProvider>
  );
}

export default App;
```

> If using the exact code above, import React hooks explicitly as shown in the next corrected version.

### Correct React imports

For React 19 and TypeScript, use explicit hook imports:

```tsx
import { useState } from 'react';
import {
  BcForgeProvider,
  useBalance,
  useTotalSupply,
} from '@bc-forge/react';

const config = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: import.meta.env.VITE_TOKEN_CONTRACT_ID,
};

function TokenDashboard() {
  const [address, setAddress] = useState('');

  const { data: balance, loading, error } = useBalance(address);
  const { data: totalSupply } = useTotalSupply();

  return (
    <main className="container">
      <h1>My First Token dApp</h1>

      <label htmlFor="wallet-address">Wallet public key</label>

      <input
        id="wallet-address"
        value={address}
        onChange={(event) => setAddress(event.target.value.trim())}
        placeholder="Enter a Stellar public key"
      />

      <section>
        <h2>Your balance</h2>

        {loading && <p>Loading balance...</p>}

        {error && (
          <p role="alert">
            Failed to load balance: {error.message}
          </p>
        )}

        {!loading && !error && (
          <p>{balance?.toString() ?? '—'}</p>
        )}
      </section>

      <section>
        <h2>Total supply</h2>
        <p>{totalSupply?.toString() ?? '—'}</p>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <BcForgeProvider config={config}>
      <TokenDashboard />
    </BcForgeProvider>
  );
}
```

## 12. Configure your frontend environment

Create a `.env.local` file in the frontend directory.

```env
VITE_TOKEN_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

The frontend uses this environment variable to identify the deployed token contract.

Vite environment variables prefixed with `VITE_` are exposed to client-side code. Only public configuration should be stored in them.

Never put an administrator secret key, wallet secret, or private credentials in a `VITE_` variable.

## 13. Run your dApp

Start the frontend development server:

```bash
npm run dev
```

Open the local URL displayed by Vite in your browser.

You should be able to:

1. See your token dApp interface.
2. Enter a Stellar public key.
3. Query the token balance.
4. View the total supply.
5. See loading and error states for requests.

If your balance query fails, verify that the contract is deployed, the contract ID is correct, and the RPC endpoint matches the network used for deployment.

## 14. Add BC Forge React screens

The BC Forge React package may provide reusable screens and components for common token workflows, such as:

- Token minting
- Token transfer
- Token burning
- Role management
- Vault interactions
- Wallet connection

Use the package's exported screens and components when appropriate instead of implementing each workflow from scratch.

Before importing a component, check the available exports in the installed package:

```typescript
import * as BcForgeReact from '@bc-forge/react';

console.log(Object.keys(BcForgeReact));
```

This can help identify the available exports in your installed version.

## 15. Common troubleshooting

### Contract not found

**Possible causes:**

- Incorrect contract ID.
- Contract deployed on a different network.
- RPC endpoint pointing to the wrong network.
- Deployment transaction did not succeed.

**Solution:** Confirm the contract ID and network. Run the CLI status check.

### Balance query fails

**Possible causes:**

- Invalid public key.
- Contract not initialized.
- RPC connection failure.
- Incorrect SDK configuration.

**Solution:** Check the account address, contract ID, and RPC URL.

### Transaction authorization fails

**Possible causes:**

- Wallet is not connected.
- Account does not have the required authorization.
- Administrator privileges are missing.
- The transaction has not been signed.

**Solution:** Verify the signer and the contract's access-control requirements.

### React component errors

**Possible causes:**

- Incorrect provider configuration.
- Missing required provider.
- Incorrect hook usage.
- Package version mismatch.

**Solution:** Confirm that your React package version is compatible with your SDK version and that components are rendered within the required provider.

## 16. Security best practices

When building Soroban dApps:

- Never expose secret keys in browser code.
- Never commit private credentials.
- Use testnet for development and experimentation.
- Validate user input before submitting transactions.
- Verify contract IDs before interacting with contracts.
- Display transaction status and errors clearly.
- Require user authorization for signing transactions.
- Keep dependencies updated.
- Use trusted RPC endpoints.
- Avoid hardcoding administrator credentials into frontend applications.

## 17. What you learned

In this tutorial, you:

- Created a token dApp project.
- Configured a Soroban testnet environment.
- Used the BC Forge CLI to configure and deploy a token.
- Connected to the deployed contract using `@bc-forge/sdk`.
- Read token metadata and balances.
- Explored mint, transfer, and burn operations.
- Integrated BC Forge into a React frontend.
- Implemented a basic token dashboard.
- Learned security considerations for token dApps.

## Next steps

You can extend this project by adding:

- Wallet connection and account switching.
- A transfer form.
- A minting interface restricted to authorized accounts.
- Transaction history.
- Token activity monitoring.
- A transaction confirmation modal.
- Better loading and error handling.
- Automated tests for SDK and UI workflows.
- Production deployment to a hosting platform.

## Resources

- [Stellar Developers](https://developers.stellar.org/)
- [Soroban Documentation](https://developers.stellar.org/docs/build/smart-contracts)
- [BC Forge SDK](https://www.npmjs.com/package/@bc-forge/sdk)
- [BC Forge CLI](https://www.npmjs.com/package/@bc-forge/cli)
- [BC Forge React](https://www.npmjs.com/package/@bc-forge/react)

Happy building!
```
