// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  getMetrics,
  getMetricsContentType,
  incrementEventsProcessed,
  resetMetricsForTests,
  setIngestionLag,
  setLatestNetworkLedger,
  timeRpcCall,
} from './metrics.js';

afterEach(() => {
  resetMetricsForTests();
});

test('metrics use the Prometheus text content type', () => {
  assert.match(getMetricsContentType(), /text\/plain/);
});

test('ledger lag gauge reflects the latest ingested lag', async () => {
  setLatestNetworkLedger(1000);
  setIngestionLag(7);
  const text = await getMetrics();
  assert.match(text, /bc_forge_indexer_ledger_lag 7/);
});

test('processed events counter accumulates', async () => {
  incrementEventsProcessed(2);
  incrementEventsProcessed();
  const text = await getMetrics();
  assert.match(text, /bc_forge_indexer_events_processed_total 3/);
});

test('RPC latency histogram observes successful calls', async () => {
  const value = await timeRpcCall(async () => 42);
  assert.equal(value, 42);
  const text = await getMetrics();
  assert.match(text, /bc_forge_indexer_rpc_latency_seconds_count 1/);
});

test('RPC latency histogram observes failed calls too', async () => {
  await assert.rejects(
    timeRpcCall(async () => {
      throw new Error('rpc down');
    }),
    /rpc down/,
  );
  const text = await getMetrics();
  assert.match(text, /bc_forge_indexer_rpc_latency_seconds_count 1/);
});
