# @bc-forge/sdk

TypeScript SDK for interacting with bc-forge token contracts deployed on the Stellar/Soroban network.

## Installation

```bash
npm install @bc-forge/sdk
# or
yarn add @bc-forge/sdk
```

## Quick Start

```typescript
import { bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';

// Initialize client
const client = new bcForgeClient({
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  contractId: 'CABC...XYZ', // Your deployed contract ID
});

// Read-only queries (no signing required)
const balance = await client.getBalance('GABC...DEF');
const supply = await client.getTotalSupply();
const name = await client.getName();
const symbol = await client.getSymbol();
const decimals = await client.getDecimals();

console.log(`${name} (${symbol}): ${balance} / ${supply} total`);
```

## Minting Tokens (Admin Only)

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

const result = await client.mint(
  'GABCDEF...RECIPIENT',
  BigInt(1000_0000000), // 1000 tokens with 7 decimals
  adminKeypair
);

console.log('Mint TX:', result.hash, 'Success:', result.success);
```

## Transferring Tokens

```typescript
const senderKeypair = Keypair.fromSecret('SXXX...SECRET');

await client.transfer(
  senderKeypair.publicKey(),
  'GABCDEF...RECIPIENT',
  BigInt(100_0000000),
  senderKeypair
);
```

## Approving & Delegated Transfers

```typescript
// Owner approves spender
await client.approve(
  ownerKeypair.publicKey(),
  'GSPENDER...ADDR',
  BigInt(500_0000000),
  ownerKeypair
);

// Check allowance
const allowance = await client.getAllowance(
  ownerKeypair.publicKey(),
  'GSPENDER...ADDR'
);
```

## Ownership Management

```typescript
// Step 1: propose a new owner
await client.proposeOwnership('GNEWADMIN...ADDR', adminKeypair);

// Step 2: the proposed owner accepts
await client.acceptOwnership(newOwnerKeypair);

// Optional: cancel before acceptance
await client.cancelOwnershipTransfer(adminKeypair);
```

```typescript
// Backwards-compatible alias for the propose step
await client.transferOwnership('GNEWADMIN...ADDR', adminKeypair);
```

## Admin Operations

```typescript
// Emergency pause / unpause
await client.pause(adminKeypair);
await client.unpause(adminKeypair);
```

## API Reference

### Read-Only Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `getBalance(address)` | `bigint` | Token balance for an address |
| `getTotalSupply()` | `bigint` | Total circulating supply |
| `getName()` | `string` | Token name |
| `getSymbol()` | `string` | Token symbol |
| `getDecimals()` | `number` | Decimal places |
| `getAllowance(owner, spender)` | `bigint` | Spending allowance |
| `getVersion()` | `string` | Contract version |

### Write Methods (require Keypair)

| Method | Description |
|--------|-------------|
| `initialize(admin, decimals, name, symbol, source)` | One-time contract setup |
| `mint(to, amount, source)` | Mint tokens (admin-only) |
| `transfer(from, to, amount, source)` | Transfer tokens |
| `approve(from, spender, amount, source)` | Set spending allowance |
| `burn(from, amount, source)` | Burn tokens |
| `proposeOwnership(newAdmin, source)` | Propose a new admin |
| `acceptOwnership(source)` | Accept a pending admin transfer |
| `cancelOwnershipTransfer(source)` | Cancel a pending admin transfer |
| `transferOwnership(newAdmin, source)` | Backwards-compatible alias for `proposeOwnership` |
| `pause(source)` | Pause contract (admin-only) |
| `unpause(source)` | Unpause contract (admin-only) |

## License

MIT
