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

// ─── RPC Pool & Connection Management ────────────────────────────────────────
export { RpcPool } from './rpc-pool';
export type { RpcPoolConfig } from './rpc-pool';

export { HealthChecker } from './health-check';
export type { HealthCheckConfig, HealthCheckResult, EndpointHealth } from './health-check';

export { CircuitBreaker, CircuitBreakerManager } from './circuit-breaker';
export type { CircuitBreakerState, CircuitBreakerConfig } from './circuit-breaker';

export { ConnectionMetrics } from './connection-metrics';
export type { EndpointMetrics, PoolMetrics } from './connection-metrics';

export { ConnectionEventEmitter } from './connection-events';
export type {
  ConnectionEvent,
  ConnectionEventListener,
  HealthCheckEvent,
  FailoverEvent,
  CircuitBreakerEvent,
  PoolEvent,
} from './connection-events';
