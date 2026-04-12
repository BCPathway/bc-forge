/**
 * @esimorph/sdk — TypeScript SDK for esimorph Token Contracts
 *
 * Re-exports the main client and utility types.
 *
 * @example
 * ```typescript
 * import { esimorphClient } from '@esimorph/sdk';
 *
 * const client = new esimorphClient({
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 *   contractId: 'CABC...XYZ',
 * });
 *
 * const balance = await client.getBalance('GABC...DEF');
 * console.log('Balance:', balance.toString());
 * ```
 */

export { esimorphClient } from './client';
export type { esimorphClientConfig, TransactionResult } from './client';
export { buildInvokeTransaction, submitTransaction, scValToNative } from './utils';
