// SPDX-License-Identifier: MIT
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

/**
 * Dedicated registry: the indexer runs alongside other workspaces, so metrics
 * are kept out of the global default registry to avoid duplicate-name errors.
 */
export const metricsRegistry = new Registry();

/** Difference between the latest on-chain ledger and the last indexed ledger. */
export const ledgerLag = new Gauge({
  name: 'bc_forge_indexer_ledger_lag',
  help: 'Number of ledgers waiting to be indexed',
  registers: [metricsRegistry],
});

/** Number of indexer events persisted successfully. */
export const eventsProcessed = new Counter({
  name: 'bc_forge_indexer_events_processed_total',
  help: 'Total number of events processed by the indexer',
  registers: [metricsRegistry],
});

/** Duration of Soroban RPC calls made by the ingestion loop. */
export const rpcLatency = new Histogram({
  name: 'bc_forge_indexer_rpc_latency_seconds',
  help: 'Latency of Soroban RPC calls in seconds',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

let latestNetworkLedger = 0;

/** Records the latest ledger reported by the network (kept for /healthz). */
export function setLatestNetworkLedger(ledger: number): void {
  latestNetworkLedger = ledger;
}

/** Returns the latest ledger reported by the network. */
export function getLatestNetworkLedger(): number {
  return latestNetworkLedger;
}

/** Updates the ingestion lag gauge with a freshly computed lag value. */
export function setIngestionLag(lag: number): void {
  ledgerLag.set(Math.max(0, lag));
}

/** Increments the processed-events counter (optionally by several events). */
export function incrementEventsProcessed(count = 1): void {
  eventsProcessed.inc(count);
}

/**
 * Times an RPC call and records its duration even when the call fails.
 */
export async function timeRpcCall<T>(call: () => Promise<T>): Promise<T> {
  const finish = rpcLatency.startTimer();
  try {
    return await call();
  } finally {
    finish();
  }
}

/** Renders all indexer metrics in Prometheus text exposition format. */
export async function getMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}

/** Content type required by Prometheus scrapers. */
export function getMetricsContentType(): string {
  return metricsRegistry.contentType;
}

/** Resets all counters/gauges between tests. */
export function resetMetricsForTests(): void {
  latestNetworkLedger = 0;
  ledgerLag.reset();
  eventsProcessed.reset();
  rpcLatency.reset();
}
