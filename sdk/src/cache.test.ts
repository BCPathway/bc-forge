/**
 * @bc-forge/sdk — Tests for CacheManager
 */

import { CacheManager, DEFAULT_CACHE_CONFIG } from './cache';

// ─── Construction ─────────────────────────────────────────────────────────────

describe('CacheManager construction', () => {
  it('uses DEFAULT_CACHE_CONFIG when no config provided', () => {
    const cache = new CacheManager();
    const m = cache.getMetrics();
    expect(m.size).toBe(0);
    expect(m.hits).toBe(0);
    expect(m.misses).toBe(0);
  });

  it('merges partial config with defaults', () => {
    const cache = new CacheManager({ maxSize: 5 });
    // fill past default max to verify custom maxSize is respected
    for (let i = 0; i < 6; i++) cache.set(`k${i}`, i);
    expect(cache.getMetrics().size).toBe(5);
  });
});

// ─── Basic get/set ────────────────────────────────────────────────────────────

describe('get / set', () => {
  let cache: CacheManager;

  beforeEach(() => {
    cache = new CacheManager({ defaultTtlMs: 60_000 });
  });

  it('returns stored value', () => {
    cache.set('a', 42);
    expect(cache.get<number>('a')).toBe(42);
  });

  it('returns undefined for missing key', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('tracks hits and misses', () => {
    cache.set('x', 'hello');
    cache.get('x'); // hit
    cache.get('y'); // miss
    const m = cache.getMetrics();
    expect(m.hits).toBe(1);
    expect(m.misses).toBe(1);
  });

  it('hitRate is NaN before any lookups', () => {
    expect(Number.isNaN(cache.getMetrics().hitRate)).toBe(true);
  });

  it('hitRate is correct after mixed lookups', () => {
    cache.set('k', 1);
    cache.get('k'); // hit
    cache.get('k'); // hit
    cache.get('z'); // miss
    expect(cache.getMetrics().hitRate).toBeCloseTo(2 / 3);
  });

  it('overwrites existing entry', () => {
    cache.set('k', 1);
    cache.set('k', 2);
    expect(cache.get<number>('k')).toBe(2);
    expect(cache.getMetrics().size).toBe(1);
  });

  it('stores bigint values', () => {
    cache.set('big', 123456789012345678901234567890n);
    expect(cache.get<bigint>('big')).toBe(123456789012345678901234567890n);
  });
});

// ─── TTL ─────────────────────────────────────────────────────────────────────

describe('TTL expiry', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns value before expiry', () => {
    const cache = new CacheManager({ defaultTtlMs: 1000 });
    cache.set('k', 'alive');
    jest.advanceTimersByTime(999);
    expect(cache.get('k')).toBe('alive');
  });

  it('returns undefined after expiry', () => {
    const cache = new CacheManager({ defaultTtlMs: 1000 });
    cache.set('k', 'alive');
    jest.advanceTimersByTime(1001);
    expect(cache.get('k')).toBeUndefined();
  });

  it('per-entry TTL overrides the default', () => {
    const cache = new CacheManager({ defaultTtlMs: 10_000 });
    cache.set('short', 'value', 500);
    jest.advanceTimersByTime(501);
    expect(cache.get('short')).toBeUndefined();
  });

  it('ttlMs=0 stores entry with no expiry', () => {
    const cache = new CacheManager({ defaultTtlMs: 1000 });
    cache.set('forever', 99, 0);
    jest.advanceTimersByTime(99_999);
    expect(cache.get<number>('forever')).toBe(99);
  });

  it('expired entries are excluded from size', () => {
    const cache = new CacheManager({ defaultTtlMs: 500 });
    cache.set('a', 1);
    jest.advanceTimersByTime(600);
    cache.get('a'); // triggers lazy removal
    expect(cache.getMetrics().size).toBe(0);
  });
});

// ─── LRU eviction ────────────────────────────────────────────────────────────

describe('LRU eviction', () => {
  it('evicts the least-recently-used entry when full', () => {
    const cache = new CacheManager({ maxSize: 3, defaultTtlMs: 0 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Access 'a' to make it MRU; 'b' is now LRU
    cache.get('a');
    cache.set('d', 4); // should evict 'b'
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('increments evictions counter', () => {
    const cache = new CacheManager({ maxSize: 2, defaultTtlMs: 0 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // evicts 'a'
    expect(cache.getMetrics().evictions).toBe(1);
  });

  it('updating an existing key does not evict', () => {
    const cache = new CacheManager({ maxSize: 2, defaultTtlMs: 0 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('a', 99); // update, not insert
    expect(cache.getMetrics().evictions).toBe(0);
    expect(cache.getMetrics().size).toBe(2);
    expect(cache.get<number>('a')).toBe(99);
  });

  it('caps size at maxSize', () => {
    const cache = new CacheManager({ maxSize: 5, defaultTtlMs: 0 });
    for (let i = 0; i < 10; i++) cache.set(`k${i}`, i);
    expect(cache.getMetrics().size).toBe(5);
  });
});

// ─── has() ────────────────────────────────────────────────────────────────────

describe('has()', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns true for live entries', () => {
    const cache = new CacheManager({ defaultTtlMs: 5000 });
    cache.set('k', 1);
    expect(cache.has('k')).toBe(true);
  });

  it('returns false for missing keys', () => {
    const cache = new CacheManager();
    expect(cache.has('missing')).toBe(false);
  });

  it('returns false for expired entries', () => {
    const cache = new CacheManager({ defaultTtlMs: 500 });
    cache.set('k', 1);
    jest.advanceTimersByTime(600);
    expect(cache.has('k')).toBe(false);
  });
});

// ─── Invalidation ─────────────────────────────────────────────────────────────

describe('invalidate()', () => {
  it('removes an existing entry and returns true', () => {
    const cache = new CacheManager();
    cache.set('k', 1);
    expect(cache.invalidate('k')).toBe(true);
    expect(cache.get('k')).toBeUndefined();
  });

  it('returns false for non-existent key', () => {
    const cache = new CacheManager();
    expect(cache.invalidate('ghost')).toBe(false);
  });
});

describe('invalidateByPrefix()', () => {
  it('removes all matching entries', () => {
    const cache = new CacheManager();
    cache.set('balance:addr1', 100n);
    cache.set('balance:addr2', 200n);
    cache.set('supply', 300n);
    const removed = cache.invalidateByPrefix('balance:');
    expect(removed).toBe(2);
    expect(cache.get('balance:addr1')).toBeUndefined();
    expect(cache.get('balance:addr2')).toBeUndefined();
    expect(cache.get<bigint>('supply')).toBe(300n);
  });

  it('returns 0 when no keys match', () => {
    const cache = new CacheManager();
    cache.set('other:key', 1);
    expect(cache.invalidateByPrefix('balance:')).toBe(0);
  });
});

describe('invalidateAll()', () => {
  it('clears all entries', () => {
    const cache = new CacheManager();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidateAll();
    expect(cache.getMetrics().size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });
});

// ─── Cache warming ────────────────────────────────────────────────────────────

describe('warmUp()', () => {
  it('pre-populates entries', () => {
    const cache = new CacheManager({ defaultTtlMs: 60_000 });
    cache.warmUp([
      { key: 'balance:addr1', value: 500n },
      { key: 'supply', value: 1000n },
    ]);
    expect(cache.get<bigint>('balance:addr1')).toBe(500n);
    expect(cache.get<bigint>('supply')).toBe(1000n);
    expect(cache.getMetrics().size).toBe(2);
  });

  it('respects per-entry ttlMs override', () => {
    jest.useFakeTimers();
    const cache = new CacheManager({ defaultTtlMs: 60_000 });
    cache.warmUp([{ key: 'k', value: 1, ttlMs: 200 }]);
    jest.advanceTimersByTime(201);
    expect(cache.get('k')).toBeUndefined();
    jest.useRealTimers();
  });

  it('does not count warm entries as cache hits', () => {
    const cache = new CacheManager();
    cache.warmUp([{ key: 'k', value: 42 }]);
    // warmUp calls set(), not get(), so metrics should be clean
    expect(cache.getMetrics().hits).toBe(0);
    expect(cache.getMetrics().misses).toBe(0);
  });
});

// ─── Metrics ─────────────────────────────────────────────────────────────────

describe('resetMetrics()', () => {
  it('zeroes counters without clearing entries', () => {
    const cache = new CacheManager();
    cache.set('k', 1);
    cache.get('k');
    cache.get('z');
    cache.resetMetrics();
    const m = cache.getMetrics();
    expect(m.hits).toBe(0);
    expect(m.misses).toBe(0);
    expect(m.evictions).toBe(0);
    expect(m.size).toBe(1); // entry still there
  });
});

// ─── localStorage persistence ─────────────────────────────────────────────────

describe('localStorage persistence', () => {
  const storageKey = 'test-cache-key';
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => { mockStorage[k] = v; },
        removeItem: (k: string) => { delete mockStorage[k]; },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    // Remove the mock
    Object.defineProperty(global, 'localStorage', { value: undefined, writable: true, configurable: true });
  });

  it('saves entries to localStorage on set', () => {
    const cache = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 0 });
    cache.set('k', 'hello');
    expect(mockStorage[storageKey]).toBeDefined();
    const parsed = JSON.parse(mockStorage[storageKey]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0][0]).toBe('k');
  });

  it('restores entries on construction', () => {
    const cache1 = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 0 });
    cache1.set('persisted', 99);

    const cache2 = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 0 });
    expect(cache2.get<number>('persisted')).toBe(99);
  });

  it('serializes and restores bigint values', () => {
    const cache1 = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 0 });
    cache1.set('bal', 9007199254740993n); // > Number.MAX_SAFE_INTEGER

    const cache2 = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 0 });
    expect(cache2.get<bigint>('bal')).toBe(9007199254740993n);
  });

  it('does not restore expired entries', () => {
    jest.useFakeTimers();
    const cache1 = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 1000 });
    cache1.set('stale', 'x');
    jest.advanceTimersByTime(1100); // expire before next cache loads

    const cache2 = new CacheManager({ persistToLocalStorage: true, storageKey });
    expect(cache2.get('stale')).toBeUndefined();
    jest.useRealTimers();
  });

  it('clears localStorage on invalidateAll', () => {
    const cache = new CacheManager({ persistToLocalStorage: true, storageKey, defaultTtlMs: 0 });
    cache.set('k', 1);
    cache.invalidateAll();
    expect(mockStorage[storageKey]).toBeUndefined();
  });

  it('does not persist when persistToLocalStorage is false', () => {
    const cache = new CacheManager({ persistToLocalStorage: false, storageKey });
    cache.set('k', 1);
    expect(mockStorage[storageKey]).toBeUndefined();
  });
});

// ─── bcForgeClient cache integration ─────────────────────────────────────────

import { bcForgeClient } from './client';
import { Keypair as _Keypair } from '@stellar/stellar-sdk';

describe('bcForgeClient cache integration', () => {
  const MOCK_RPC = 'https://soroban-testnet.stellar.org';
  const MOCK_PASSPHRASE = 'Test SDF Network ; September 2015';
  const MOCK_CONTRACT = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
  const ADDR_A = _Keypair.random().publicKey();
  const ADDR_B = _Keypair.random().publicKey();

  function makeClient(): bcForgeClient {
    return new bcForgeClient({
      rpcUrl: MOCK_RPC,
      networkPassphrase: MOCK_PASSPHRASE,
      contractId: MOCK_CONTRACT,
      cacheConfig: { defaultTtlMs: 60_000 },
    });
  }

  it('getCacheMetrics returns undefined without cacheConfig', () => {
    const client = new bcForgeClient({
      rpcUrl: MOCK_RPC,
      networkPassphrase: MOCK_PASSPHRASE,
      contractId: MOCK_CONTRACT,
    });
    expect(client.getCacheMetrics()).toBeUndefined();
  });

  it('getCacheMetrics returns metrics with cacheConfig', () => {
    const client = makeClient();
    const m = client.getCacheMetrics();
    expect(m).toBeDefined();
    expect(m!.hits).toBe(0);
  });

  it('getBalance returns cached value on second call', async () => {
    const client = makeClient();
    const queryContract = jest.fn().mockResolvedValue({
      toXDR: () => Buffer.alloc(0),
    });
    // Seed the cache manually to simulate a cached balance
    const cache: CacheManager = (client as any).cache;
    cache.set(`balance:${ADDR_A}`, 1000n);

    // Now getBalance should return the cached value without calling queryContract
    const patchedQueryContract = jest.fn();
    (client as any).queryContract = patchedQueryContract;

    const result = await client.getBalance(ADDR_A);
    expect(result).toBe(1000n);
    expect(patchedQueryContract).not.toHaveBeenCalled();

    const metrics = client.getCacheMetrics()!;
    expect(metrics.hits).toBeGreaterThanOrEqual(1);
  });

  it('clearCache empties all entries', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set('supply', 5000n);
    cache.set(`balance:${ADDR_A}`, 100n);
    client.clearCache();
    expect(cache.getMetrics().size).toBe(0);
  });

  it('warmUpCache pre-populates the cache', () => {
    const client = makeClient();
    client.warmUpCache([
      { key: `balance:${ADDR_A}`, value: 999n },
      { key: 'supply', value: 5000n },
    ]);
    const cache: CacheManager = (client as any).cache;
    expect(cache.get<bigint>(`balance:${ADDR_A}`)).toBe(999n);
    expect(cache.get<bigint>('supply')).toBe(5000n);
  });

  it('invalidates balance and supply after successful mint', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set(`balance:${ADDR_A}`, 100n);
    cache.set('supply', 500n);

    // Mock invokeContract to return success
    (client as any).invokeContract = jest.fn().mockResolvedValue({ success: true, hash: 'h1' });

    const { Keypair } = await import('@stellar/stellar-sdk');
    await client.mint(ADDR_A, 50n, Keypair.random());

    expect(cache.get(`balance:${ADDR_A}`)).toBeUndefined();
    expect(cache.get('supply')).toBeUndefined();
  });

  it('does NOT invalidate on failed mint', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set(`balance:${ADDR_A}`, 100n);
    cache.set('supply', 500n);

    (client as any).invokeContract = jest.fn().mockResolvedValue({ success: false, hash: 'h1' });

    const { Keypair } = await import('@stellar/stellar-sdk');
    await client.mint(ADDR_A, 50n, Keypair.random());

    expect(cache.get<bigint>(`balance:${ADDR_A}`)).toBe(100n);
    expect(cache.get<bigint>('supply')).toBe(500n);
  });

  it('invalidates sender and receiver balances after transfer', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set(`balance:${ADDR_A}`, 100n);
    cache.set(`balance:${ADDR_B}`, 200n);

    (client as any).invokeContract = jest.fn().mockResolvedValue({ success: true, hash: 'h1' });

    const { Keypair } = await import('@stellar/stellar-sdk');
    await client.transfer(ADDR_A, ADDR_B, 10n, Keypair.random());

    expect(cache.get(`balance:${ADDR_A}`)).toBeUndefined();
    expect(cache.get(`balance:${ADDR_B}`)).toBeUndefined();
  });

  it('invalidates allowance after approve', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set(`allowance:${ADDR_A}:${ADDR_B}`, 50n);

    (client as any).invokeContract = jest.fn().mockResolvedValue({ success: true, hash: 'h1' });

    const { Keypair } = await import('@stellar/stellar-sdk');
    await client.approve(ADDR_A, ADDR_B, 100n, Keypair.random());

    expect(cache.get(`allowance:${ADDR_A}:${ADDR_B}`)).toBeUndefined();
  });

  it('invalidates balance and supply after burn', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set(`balance:${ADDR_A}`, 100n);
    cache.set('supply', 500n);

    (client as any).invokeContract = jest.fn().mockResolvedValue({ success: true, hash: 'h1' });

    const { Keypair } = await import('@stellar/stellar-sdk');
    await client.burn(ADDR_A, 20n, Keypair.random());

    expect(cache.get(`balance:${ADDR_A}`)).toBeUndefined();
    expect(cache.get('supply')).toBeUndefined();
  });

  it('invalidates name after updateName', async () => {
    const client = makeClient();
    const cache: CacheManager = (client as any).cache;
    cache.set('name', 'OldName');

    (client as any).invokeContract = jest.fn().mockResolvedValue({ success: true, hash: 'h1' });

    const { Keypair } = await import('@stellar/stellar-sdk');
    await client.updateName('NewName', Keypair.random());

    expect(cache.get('name')).toBeUndefined();
  });
});
