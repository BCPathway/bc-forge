/**
 * @bc-forge/sdk — TypeScript SDK for bc-forge Token Contracts
 *
 * Re-exports the main client, utility types, and custom error classes.
 *
 * Supports read-only mode without a wallet or keypair (queries, balance checks, event polling)
 * as well as write operations using a Keypair or connected WalletAdapter.
 *
 * @example Read-only mode:
 * ```typescript
 * import { bcForgeClient } from '@bc-forge/sdk';
 *
 * const client = new bcForgeClient({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 *   contractId: 'CABC...XYZ',
 * });
 *
 * const balance = await client.getBalance('GABC...DEF');
 * console.log('Balance:', balance);
 * ```
 */

export { bcForgeClient, Role } from './client';
export type {
  BatchMintRecipient,
  bcForgeClientConfig,
  RbacInitResult,
  TransactionResult,
} from './client';
export { buildInvokeTransaction, submitTransaction, scValToNative } from './utils';
export { bcForgeEventType, decodeEvent, decodeDiagnosticEvent, subscribeEvents } from './events';
export type { bcForgeEvent, SubscriptionOptions } from './events';
export * from './errors';
export * from './mockClient';

export type { WalletAdapter } from './walletAdapter';
export { FreighterAdapter } from './adapters/freighterAdapter';
export { AlbedoAdapter } from './adapters/albedoAdapter';
export { WalletConnectAdapter } from './adapters/walletConnectAdapter';

// ─── Vault and Wrapper Clients (#744) ────────────────────────────────────────
export { VaultClient } from './vaultClient';
export type { VaultClientConfig } from './vaultClient';
export { WrapperClient } from './wrapperClient';
export type { WrapperClientConfig } from './wrapperClient';

// ─── APY helpers (#745) ──────────────────────────────────────────────────────
export { calculateApy } from './apy';
export type { ApyOptions, ApyResult, ApySnapshot } from './apy';

