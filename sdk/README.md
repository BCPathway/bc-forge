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
  adminKeypair,
);

console.log('Mint TX:', result.hash, 'Success:', result.success);
```

## Batch Minting Tokens (Admin Only)

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

await client.batchMint(
  [
    { to: 'GABCDEF...RECIPIENT1', amount: BigInt(1000_0000000) },
    { to: 'GHIJKL...RECIPIENT2', amount: BigInt(250_0000000) },
  ],
  adminKeypair,
);
```

## Transferring Tokens

```typescript
const senderKeypair = Keypair.fromSecret('SXXX...SECRET');

await client.transfer(
  senderKeypair.publicKey(),
  'GABCDEF...RECIPIENT',
  BigInt(100_0000000),
  senderKeypair,
);
```

## Burning Tokens

```typescript
const ownerKeypair = Keypair.fromSecret('SXXX...SECRET');

// Burn 50 tokens from owner's balance
const burnResult = await client.burn(ownerKeypair.publicKey(), BigInt(50_0000000), ownerKeypair);
console.log('Burn TX:', burnResult.hash, 'Success:', burnResult.success);
```

## Approving & Delegated Transfers

```typescript
// Owner approves spender
await client.approve(
  ownerKeypair.publicKey(),
  'GSPENDER...ADDR',
  BigInt(500_0000000),
  ownerKeypair,
);

// Check allowance
const allowance = await client.getAllowance(ownerKeypair.publicKey(), 'GSPENDER...ADDR');
console.log('Allowance:', allowance);
```

## Querying Allowance

```typescript
const allowance = await client.getAllowance('GOWNER...ADDR', 'GSPENDER...ADDR');
console.log('Allowance:', allowance);
```

## Querying Contract Version

```typescript
const version = await client.getVersion();
console.log('Contract version:', version);
```

## Batch Queries

```typescript
// Get balances for multiple addresses at once
const addresses = [
  'GABC...ADDR1',
  'GDEF...ADDR2',
  'GHIJ...ADDR3',
];

const balances = await client.getBalances(addresses);
balances.forEach((balance, index) => {
  console.log(`${addresses[index]}: ${balance}`);
});

// Custom batch size
const balances = await client.getBalances(addresses, 5); // Process 5 at a time
```

## Querying Events

```typescript
// Get recent events (last 1000 ledgers by default)
const events = await client.getEvents();
events.forEach(event => {
  console.log('Event:', event);
});

// Get events from a specific starting ledger
const events = await client.getEvents(12345);
```

## Initializing the Contract

```typescript
const deployerKeypair = Keypair.fromSecret('SXXX...SECRET');

// One-time contract initialization
await client.initialize(
  deployerKeypair.publicKey(),  // Admin address
  7,                            // Decimals
  'My Token',                   // Token name
  'MTK',                        // Token symbol
  deployerKeypair               // Signer
);
console.log('Contract initialized');
```

## Batch Minting

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

// Mint to multiple recipients in one transaction
const recipients = [
  ['GABC...RECIPIENT1', BigInt(1000_0000000)],  // 1000 tokens
  ['GDEF...RECIPIENT2', BigInt(500_0000000)],   // 500 tokens
  ['GHIJ...RECIPIENT3', BigInt(250_0000000)],   // 250 tokens
];

const result = await client.batchMint(recipients, adminKeypair);
console.log('Batch mint TX:', result.hash, 'Success:', result.success);
```

## Offline Transaction Building

```typescript
const adminPublicKey = 'GABC...ADMIN';

// Build unsigned mint transaction
const unsignedMintTx = await client.buildMintTx(
  'GDEF...RECIPIENT',
  BigInt(1000_0000000),
  adminPublicKey
);

// Build unsigned transfer transaction
const unsignedTransferTx = await client.buildTransferTx(
  'GABC...SENDER',
  'GDEF...RECIPIENT',
  BigInt(100_0000000),
  adminPublicKey
);

// Build unsigned approve transaction
const unsignedApproveTx = await client.buildApproveTx(
  'GABC...OWNER',
  'GDEF...SPENDER',
  BigInt(500_0000000),
  0,  // Expiration ledger (0 = no expiration)
  adminPublicKey
);

// Build unsigned burn transaction
const unsignedBurnTx = await client.buildBurnTx(
  'GABC...OWNER',
  BigInt(50_0000000),
  adminPublicKey
);
```

## Signing Offline Transactions

```typescript
const keypair = Keypair.fromSecret('SXXX...SECRET');

// Sign an unsigned transaction XDR
const signedTx = client.signTx(unsignedMintTx, keypair);
console.log('Signed transaction:', signedTx);
```

## Simulating Transactions

```typescript
const adminPublicKey = 'GABC...ADMIN';

// Simulate a generic contract method
const simResult = await client.simulate(
  'mint',
  [addressToScVal('GDEF...RECIPIENT'), i128ToScVal(BigInt(1000_0000000))],
  adminPublicKey
);
console.log('Simulation result:', simResult);

// Simulate mint operation
const mintSim = await client.simulateMint(
  'GDEF...RECIPIENT',
  BigInt(1000_0000000),
  adminPublicKey
);
console.log('Mint simulation:', mintSim);

// Simulate transfer operation
const transferSim = await client.simulateTransfer(
  'GABC...SENDER',
  'GDEF...RECIPIENT',
  BigInt(100_0000000),
  adminPublicKey
);
console.log('Transfer simulation:', transferSim);
```

## Multi-Signature Admin Pool

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

// Configure multi-sig admin pool
const adminPool = [
  'GADMIN1...ADDR',
  'GADMIN2...ADDR',
  'GADMIN3...ADDR',
];
const threshold = 2; // Require 2 of 3 signatures

await client.setAdminPool(adminPool, threshold, adminKeypair);
console.log('Admin pool configured');
```

## Upgrading the Contract

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

// Upgrade to new WASM hash
const newWasmHash = 'a1b2c3d4e5f6...'; // 32-byte hex string
await client.upgrade(newWasmHash, adminKeypair);
console.log('Contract upgraded');
```

## Multi-Sig Proposals

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

// Propose a mint action
const mintResult = await client.proposeAction(
  adminKeypair.publicKey(),
  { Mint: ['GDEF...RECIPIENT', BigInt(1000_0000000)] },
  'Mint 1000 tokens to recipient',
  adminKeypair
);
console.log('Mint proposal created:', mintResult.hash);

// Propose a pause action
const pauseResult = await client.proposeAction(
  adminKeypair.publicKey(),
  { Pause: [] },
  'Pause contract for maintenance',
  adminKeypair
);
console.log('Pause proposal created:', pauseResult.hash);

// Approve a proposal (by another admin)
const admin2Keypair = Keypair.fromSecret('SXXX...SECRET2');
await client.approveProposal(
  admin2Keypair.publicKey(),
  BigInt(1), // Proposal ID
  admin2Keypair
);

// Execute a proposal once quorum is reached
await client.executeProposal(BigInt(1), adminKeypair);
console.log('Proposal executed');
```

## Regulatory Operations

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

// Set clawback administrator
await client.setClawbackAdmin('GCLAWBACK...ADMIN', adminKeypair);
console.log('Clawback admin set');

// Execute clawback (from clawback admin)
const clawbackKeypair = Keypair.fromSecret('SXXX...CLAWBACK');
await client.clawback(
  'GABC...FROM',
  'GDEF...TO',
  BigInt(100_0000000),
  clawbackKeypair
);
console.log('Clawback executed');

// Update token name
await client.updateName('New Token Name', adminKeypair);
console.log('Token name updated');

// Update token symbol
await client.updateSymbol('NEW', adminKeypair);
console.log('Token symbol updated');
```

## Token Locking and Vesting

```typescript
const adminKeypair = Keypair.fromSecret('SXXX...SECRET');

// Lock tokens for a user (unlock timestamp in seconds)
const unlockTime = BigInt(Math.floor(Date.now() / 1000) + 86400); // 24 hours from now
await client.lockTokens(
  'GABC...USER',
  BigInt(1000_0000000),
  unlockTime,
  adminKeypair
);
console.log('Tokens locked');

// Withdraw matured locked tokens
const userKeypair = Keypair.fromSecret('SXXX...USER');
await client.withdrawLocked(userKeypair.publicKey(), userKeypair);
console.log('Locked tokens withdrawn');
```

## Admin Operations

```typescript
// Transfer ownership
await client.transferOwnership('GNEWADMIN...ADDR', adminKeypair);

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
| `getBalances(addresses[], batchSize)` | `bigint[]` | Batch query multiple balances |
| `getEvents(startLedger?)` | `any[]` | Get contract events |

### Write Methods (require Keypair)

| Method | Description |
|--------|-------------|
| `initialize(admin, decimals, name, symbol, source)` | One-time contract setup |
| `mint(to, amount, source)` | Mint tokens (admin-only) |
| `batchMint(recipients[], source)` | Batch mint to multiple addresses (admin-only) |
| `transfer(from, to, amount, source)` | Transfer tokens |
| `approve(from, spender, amount, source)` | Set spending allowance |
| `burn(from, amount, source)` | Burn tokens |
| `transferOwnership(newAdmin, source)` | Transfer admin role |
| `pause(source)` | Pause contract (admin-only) |
| `unpause(source)` | Unpause contract (admin-only) |
| `setAdminPool(pool[], threshold, source)` | Configure multi-sig admin pool |
| `upgrade(newWasmHash, source)` | Upgrade contract WASM (admin-only) |
| `proposeAction(admin, action, description, source)` | Propose multi-sig action |
| `approveProposal(admin, proposalId, source)` | Approve a proposal |
| `executeProposal(proposalId, source)` | Execute approved proposal |
| `setClawbackAdmin(admin, source)` | Set clawback administrator |
| `clawback(from, to, amount, source)` | Execute clawback |
| `updateName(newName, source)` | Update token name (admin-only) |
| `updateSymbol(newSymbol, source)` | Update token symbol (admin-only) |
| `lockTokens(user, amount, unlockTime, source)` | Lock tokens for vesting |
| `withdrawLocked(user, source)` | Withdraw matured locked tokens |

### Offline Transaction Builders

| Method | Returns | Description |
|--------|---------|-------------|
| `buildMintTx(to, amount, sourcePublicKey)` | `string` | Build unsigned mint transaction XDR |
| `buildTransferTx(from, to, amount, sourcePublicKey)` | `string` | Build unsigned transfer transaction XDR |
| `buildApproveTx(from, spender, amount, exp, sourcePublicKey)` | `string` | Build unsigned approve transaction XDR |
| `buildBurnTx(from, amount, sourcePublicKey)` | `string` | Build unsigned burn transaction XDR |
| `signTx(txXdr, keypair)` | `string` | Sign unsigned transaction XDR |

### Simulation Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `simulate(method, args, sourcePublicKey)` | `any` | Simulate generic contract method |
| `simulateMint(to, amount, sourcePublicKey)` | `any` | Simulate mint operation |
| `simulateTransfer(from, to, amount, sourcePublicKey)` | `any` | Simulate transfer operation |

## License

MIT
