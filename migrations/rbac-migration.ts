/**
 * @bc-forge/rbac-migration — RBAC Storage Migration Script
 *
 * Migrates legacy admin contracts from the singular AdminKey::Admin state
 * to the new RBAC format with AdminKey::SuperAdmin mapping.
 *
 * This script is designed to be run via the CLI or imported as a library:
 *
 * ```bash
 * # Via CLI (interactive)
 * npx ts-node migrations/rbac-migration.ts \
 *   --rpc-url https://soroban-testnet.stellar.org \
 *   --network-passphrase "Test SDF Network ; September 2015" \
 *   --contract-id <CONTRACT_ID> \
 *   --admin-secret <ADMIN_SECRET>
 *
 * # Or as a library
 * import { migrateContract } from '@bc-forge/rbac-migration';
 * const result = await migrateContract(config);
 * ```
 *
 * ## What it does
 *
 * 1. **Reads** the current admin address from instance storage (`AdminKey::Admin`)
 * 2. **Creates** a new persistent storage entry mapping that address to `true`
 *    under `AdminKey::SuperAdmin(address)`
 * 3. **Extends** the TTL of the new SuperAdmin storage entry
 * 4. **Verifies** the migration was successful by querying `has_role(SuperAdmin, admin)`
 *
 * ## Safety
 *
 * - The migration is **idempotent**: calling it multiple times is a no-op
 * - The original admin entry in instance storage remains unchanged
 * - No tokens, balances, or other state is modified
 * - The migration only adds a new storage entry; it never removes existing entries
 *
 * ## Storage Layout Changes
 *
 * Before migration:
 * - `AdminKey::Admin` (instance) → `Address`
 *
 * After migration:
 * - `AdminKey::Admin` (instance) → `Address` (unchanged)
 * - `AdminKey::SuperAdmin(address)` (persistent) → `true` (new entry)
 *
 * @module migrations/rbac-migration
 */

// Node.js globals
declare const console: Console;
declare const process: {
  argv: string[];
  exit(code?: number): never;
};

// Suppress unused variable warnings for the CLI part
void console;
void process;

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  nativeToScVal,
  scValToNative,
  Address,
} from '@stellar/stellar-sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MigrationConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed contract ID to migrate */
  contractId: string;
  /** Admin keypair for signing the migration transaction */
  adminKeypair: Keypair;
}

export interface MigrationResult {
  /** Whether the migration was successful */
  success: boolean;
  /** Transaction hash */
  hash?: string;
  /** Error message if migration failed */
  error?: string;
  /** Whether migration was a no-op (already migrated) */
  alreadyMigrated?: boolean;
  /** Admin address that was migrated */
  adminAddress?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** The well-known Stellar zero address sentinel */
const ZERO_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/** Maximum number of retries for RPC calls */
const MAX_RETRIES = 3;

/** Delay between retries in milliseconds */
const RETRY_DELAY_MS = 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sleep for the specified duration.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry an async operation with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number = MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i < retries - 1) {
        await sleep(RETRY_DELAY_MS * (i + 1));
      }
    }
  }
  throw lastError;
}

// ─── Migration Functions ─────────────────────────────────────────────────────

/**
 * Check if the contract has an admin set.
 *
 * @param server - Soroban RPC server instance
 * @param networkPassphrase - Network passphrase
 * @param contractId - Contract ID to check
 * @returns Whether an admin is set
 */
async function hasAdmin(
  server: SorobanRpc.Server,
  networkPassphrase: string,
  contractId: string,
): Promise<boolean> {
  const contract = new Contract(contractId);

  // Create a dummy account for the simulation (zero address)
  const account = new (await import('@stellar/stellar-sdk')).Account(
    ZERO_ADDRESS,
    '0',
  );

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call('has_admin'))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
    throw new Error('has_admin query returned no result');
  }

  return scValToNative(simulated.result.retval) as boolean;
}

/**
 * Check if an address holds a specific role.
 *
 * @param server - Soroban RPC server instance
 * @param networkPassphrase - Network passphrase
 * @param contractId - Contract ID to check
 * @param role - Role to check (e.g., 'SuperAdmin')
 * @param address - Address to check
 * @returns Whether the address holds the role
 */
async function hasRole(
  server: SorobanRpc.Server,
  networkPassphrase: string,
  contractId: string,
  role: string,
  address: string,
): Promise<boolean> {
  const contract = new Contract(contractId);

  const roleScVal = nativeToScVal(role, { type: 'symbol' });
  const addressScVal = new Address(address).toScVal();

  // Create a dummy account for the simulation (zero address)
  const account = new (await import('@stellar/stellar-sdk')).Account(
    ZERO_ADDRESS,
    '0',
  );

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call('has_role', roleScVal, addressScVal))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
    throw new Error('has_role query returned no result');
  }

  return scValToNative(simulated.result.retval) as boolean;
}

/**
 * Execute the RBAC storage migration on a deployed contract.
 *
 * This function copies the singular admin address from `AdminKey::Admin`
 * to `AdminKey::SuperAdmin(admin)`, enabling the `require_super_admin`
 * guard for legacy contracts without resetting state.
 *
 * @param config - Migration configuration
 * @returns Migration result with status and transaction details
 *
 * @example
 * ```typescript
 * import { migrateContract } from '@bc-forge/rbac-migration';
 * import { Keypair } from '@stellar/stellar-sdk';
 *
 * const result = await migrateContract({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 *   contractId: 'CASB...XXXX',
 *   adminKeypair: Keypair.fromSecret(process.env.ADMIN_SECRET!),
 * });
 *
 * console.log('Migration result:', result);
 * ```
 */
export async function migrateContract(
  config: MigrationConfig,
): Promise<MigrationResult> {
  const { rpcUrl, networkPassphrase, contractId, adminKeypair } = config;

  const server = new SorobanRpc.Server(rpcUrl);
  const contract = new Contract(contractId);

  try {
    // Step 1: Check if contract has an admin
    const hasAdminResult = await withRetry(() =>
      hasAdmin(server, networkPassphrase, contractId),
    );

    if (!hasAdminResult) {
      return {
        success: false,
        error: 'Contract has no admin set. Migration requires an initialized contract.',
      };
    }

    // Step 2: Check if already migrated (admin already has SuperAdmin role)
    const adminAddress = adminKeypair.publicKey();
    const alreadyHasSuperAdmin = await withRetry(() =>
      hasRole(
        server,
        networkPassphrase,
        contractId,
        'SuperAdmin',
        adminAddress,
      ),
    );

    if (alreadyHasSuperAdmin) {
      return {
        success: true,
        alreadyMigrated: true,
        adminAddress,
      };
    }

    // Step 3: Build and sign the migration transaction
    const sourceAccount = await server.getAccount(adminAddress);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(contract.call('migrate_admin'))
      .setTimeout(60)
      .build();

    // Step 4: Simulate to get the assembled transaction
    const simulated = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulated)) {
      return {
        success: false,
        error: `Simulation failed: ${simulated.error}`,
      };
    }

    // Step 5: Sign the transaction
    const assembled = SorobanRpc.assembleTransaction(tx, simulated).build();
    assembled.sign(adminKeypair);

    // Step 6: Submit the transaction
    const sendResponse = await server.sendTransaction(assembled);

    if (sendResponse.status === 'ERROR') {
      return {
        success: false,
        error: `Transaction submission failed: ${JSON.stringify(sendResponse.errorResult)}`,
      };
    }

    // Step 7: Poll for transaction completion
    let getResponse: SorobanRpc.Api.GetTransactionResponse;
    let attempts = 0;
    const maxAttempts = 30;

    do {
      await sleep(1000);
      getResponse = await server.getTransaction(sendResponse.hash);
      attempts++;
    } while (
      getResponse.status ===
        SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
      attempts < maxAttempts
    );

    if (
      getResponse.status ===
      SorobanRpc.Api.GetTransactionStatus.NOT_FOUND
    ) {
      return {
        success: false,
        hash: sendResponse.hash,
        error: 'Transaction not found after maximum polling attempts',
      };
    }

    if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      // Step 8: Verify migration was successful
      const verifyHasSuperAdmin = await withRetry(() =>
        hasRole(
          server,
          networkPassphrase,
          contractId,
          'SuperAdmin',
          adminAddress,
        ),
      );

      if (!verifyHasSuperAdmin) {
        return {
          success: false,
          hash: sendResponse.hash,
          error: 'Migration transaction succeeded but verification failed: admin does not have SuperAdmin role',
        };
      }

      return {
        success: true,
        hash: sendResponse.hash,
        adminAddress,
      };
    }

    return {
      success: false,
      hash: sendResponse.hash,
      error: `Transaction failed with status: ${getResponse.status}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Dry-run the migration to check if it would succeed without submitting.
 *
 * @param config - Migration configuration
 * @returns Migration result with status (no transaction submitted)
 */
export async function dryRunMigration(
  config: MigrationConfig,
): Promise<MigrationResult> {
  const { rpcUrl, networkPassphrase, contractId, adminKeypair } = config;

  const server = new SorobanRpc.Server(rpcUrl);
  const adminAddress = adminKeypair.publicKey();

  try {
    // Check if contract has an admin
    const hasAdminResult = await withRetry(() =>
      hasAdmin(server, networkPassphrase, contractId),
    );

    if (!hasAdminResult) {
      return {
        success: false,
        error: 'Contract has no admin set. Migration requires an initialized contract.',
      };
    }

    // Check if already migrated
    const alreadyHasSuperAdmin = await withRetry(() =>
      hasRole(
        server,
        networkPassphrase,
        contractId,
        'SuperAdmin',
        adminAddress,
      ),
    );

    if (alreadyHasSuperAdmin) {
      return {
        success: true,
        alreadyMigrated: true,
        adminAddress,
      };
    }

    // Simulate the migration transaction
    const contract = new Contract(contractId);
    const sourceAccount = await server.getAccount(adminAddress);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase,
    })
      .addOperation(contract.call('migrate_admin'))
      .setTimeout(60)
      .build();

    const simulated = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(simulated)) {
      return {
        success: false,
        error: `Dry-run simulation failed: ${simulated.error}`,
      };
    }

    return {
      success: true,
      alreadyMigrated: false,
      adminAddress,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

/**
 * Parse CLI arguments and run the migration.
 */
async function main() {
  const args = process.argv.slice(2);

  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const rpcUrl = getArg('rpc-url') ?? '';
  const networkPassphrase = getArg('network-passphrase') ?? '';
  const contractId = getArg('contract-id') ?? '';
  const adminSecret = getArg('admin-secret') ?? '';
  const dryRun = args.includes('--dry-run');

  if (!rpcUrl || !networkPassphrase || !contractId || !adminSecret) {
    console.error(`
Usage: npx ts-node migrations/rbac-migration.ts [options]

Options:
  --rpc-url <url>              Soroban RPC endpoint URL (required)
  --network-passphrase <pass>  Stellar network passphrase (required)
  --contract-id <id>           Deployed contract ID (required)
  --admin-secret <secret>      Admin secret key for signing (required)
  --dry-run                    Simulate migration without submitting
  --help                       Show this help message
    `);
    process.exit(1);
  }

  const adminKeypair = Keypair.fromSecret(adminSecret);

  const config: MigrationConfig = {
    rpcUrl,
    networkPassphrase,
    contractId,
    adminKeypair,
  };

  console.log('RBAC Storage Migration');
  console.log('======================');
  console.log(`Contract ID: ${contractId}`);
  console.log(`Admin: ${adminKeypair.publicKey()}`);
  console.log(`Network: ${networkPassphrase}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('');

  let result: MigrationResult;

  if (dryRun) {
    console.log('Running dry-run (no transaction submitted)...');
    result = await dryRunMigration(config);
  } else {
    console.log('Executing migration...');
    result = await migrateContract(config);
  }

  console.log('');
  console.log('Result:');
  console.log(JSON.stringify(result, null, 2));

  if (result.success) {
    if (result.alreadyMigrated) {
      console.log('\n✓ Contract is already migrated. No action needed.');
    } else {
      console.log(`\n✓ Migration successful! TX: ${result.hash}`);
    }
  } else {
    console.error(`\n✗ Migration failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unexpected error:', error);
    process.exit(1);
  });
}
