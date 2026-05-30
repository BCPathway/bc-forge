/**
 * @bc-forge/sdk — TypeScript SDK for bc-forge Token Contracts
 *
 * Re-exports the main client and utility types.
 *
 * @example
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
 * console.log('Balance:', balance.toString());
 * ```
 */

export { bcForgeClient } from './client';
export type { BatchMintRecipient, bcForgeClientConfig, TransactionResult } from './client';
export { buildInvokeTransaction, submitTransaction, scValToNative } from './utils';
export { bcForgeEventType, decodeEvent, decodeDiagnosticEvent, subscribeEvents } from './events';
export type { bcForgeEvent, SubscriptionOptions } from './events';
export * from './mockClient';

export type { WalletAdapter } from './walletAdapter';
export { FreighterAdapter } from './adapters/freighterAdapter';
export { AlbedoAdapter } from './adapters/albedoAdapter';
export { WalletConnectAdapter } from './adapters/walletConnectAdapter';
