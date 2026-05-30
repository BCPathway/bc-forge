/**
 * @bc-forge/sdk — In-memory caching layer for read-only contract queries.
 *
 * Features:
 *  - LRU eviction with O(1) get/set using Map insertion-order
 *  - Per-entry and global TTL
 *  - Hit/miss/eviction metrics
 *  - Optional localStorage persistence (browser environments)
 *  - Cache warming (pre-populate with known values)
 *  - Prefix-based and full invalidation for post-write consistency
 */

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  value: T;
  /** Absolute epoch-ms expiry. 0 = no expiry. */
  expiresAt: number;
  createdAt: number;
  /** Number of times this entry has been read from cache. */
  hits: number;
}

export interface CacheMetrics {
  /** Total cache hits since last reset. */
  hits: number;
  /** Total cache misses since last reset. */
  misses: number;
  /** Total LRU evictions since last reset. */
  evictions: number;
  /** Current number of entries in the cache. */
  size: number;
  /** Ratio of hits to total lookups (0–1). NaN when no lookups yet. */
  hitRate: number;
}

export interface CacheWarmEntry<T> {
  key: string;
  value: T;
  /** Override TTL for this entry (ms). Uses config default when omitted. */
  ttlMs?: number;
}

export interface CacheConfig {
  /**
   * Default TTL in milliseconds for new entries.
   * 0 disables expiry (entries live until evicted or manually invalidated).
   * Default: 30 000 (30 s)
   */
  defaultTtlMs: number;
  /**
   * Maximum number of live entries. When full, the least-recently-used
   * entry is evicted on the next set(). Default: 100.
   */
  maxSize: number;
  /**
   * Persist the cache to localStorage across page reloads (browser only).
   * Gracefully no-ops in Node / SSR environments. Default: false.
   */
  persistToLocalStorage: boolean;
  /**
   * localStorage key used to save/restore this cache instance.
   * Default: 'bc-forge-sdk-cache'
   */
  storageKey: string;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  defaultTtlMs: 30_000,
  maxSize: 100,
  persistToLocalStorage: false,
  storageKey: 'bc-forge-sdk-cache',
};

// ─── CacheManager ─────────────────────────────────────────────────────────────

export class CacheManager {
  private readonly entries: Map<string, CacheEntry<any>> = new Map();
  private readonly config: CacheConfig;
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...(config ?? {}) };
    if (this.config.persistToLocalStorage) {
      this.loadFromStorage();
    }
  }

  // ─── Core get/set ──────────────────────────────────────────────────────────

  /**
   * Retrieve a cached value. Returns `undefined` on miss or expiry.
   * Promotes the entry to most-recently-used on hit.
   */
  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this._misses++;
      return undefined;
    }
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      this._misses++;
      return undefined;
    }
    // Promote to MRU by reinserting at the end of the Map.
    this.entries.delete(key);
    entry.hits++;
    this.entries.set(key, entry);
    this._hits++;
    return entry.value;
  }

  /**
   * Store a value. Evicts the LRU entry if the cache is at capacity.
   *
   * @param key    - Cache key
   * @param value  - Value to store
   * @param ttlMs  - Override TTL in ms. Uses `defaultTtlMs` when omitted.
   *                 Pass `0` explicitly to store with no expiry.
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    // If the key already exists, remove it first so we can re-insert at the end.
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.config.maxSize) {
      this.evictLRU();
    }

    const effectiveTtl = ttlMs !== undefined ? ttlMs : this.config.defaultTtlMs;
    const expiresAt = effectiveTtl > 0 ? Date.now() + effectiveTtl : 0;

    this.entries.set(key, {
      value,
      expiresAt,
      createdAt: Date.now(),
      hits: 0,
    });

    this.persistIfEnabled();
  }

  /**
   * Return true if there is a live (non-expired) entry for `key`.
   */
  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (this.isExpired(entry)) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  // ─── Invalidation ──────────────────────────────────────────────────────────

  /**
   * Remove a single entry. Returns true if the key existed.
   */
  invalidate(key: string): boolean {
    const deleted = this.entries.delete(key);
    if (deleted) this.persistIfEnabled();
    return deleted;
  }

  /**
   * Remove all entries whose keys start with `prefix`.
   * Returns the number of entries removed.
   *
   * @example
   * cache.invalidateByPrefix('balance:') // removes all per-address balances
   */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
        count++;
      }
    }
    if (count > 0) this.persistIfEnabled();
    return count;
  }

  /**
   * Remove all cached entries and clear persisted storage.
   */
  invalidateAll(): void {
    this.entries.clear();
    this.clearStorage();
  }

  // ─── Cache warming ─────────────────────────────────────────────────────────

  /**
   * Pre-populate the cache with a set of known values.
   * Useful for server-side rendering or seeding from a trusted data source.
   */
  warmUp<T>(warmEntries: CacheWarmEntry<T>[]): void {
    for (const { key, value, ttlMs } of warmEntries) {
      this.set(key, value, ttlMs);
    }
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────

  /**
   * Return a snapshot of cache performance metrics.
   */
  getMetrics(): CacheMetrics {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.entries.size,
      hitRate: total > 0 ? this._hits / total : NaN,
    };
  }

  /**
   * Reset hit/miss/eviction counters without clearing the cache.
   */
  resetMetrics(): void {
    this._hits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private isExpired(entry: CacheEntry<any>): boolean {
    return entry.expiresAt > 0 && Date.now() > entry.expiresAt;
  }

  private evictLRU(): void {
    // Map preserves insertion order; the first key is the LRU entry.
    const firstKey = this.entries.keys().next().value;
    if (firstKey !== undefined) {
      this.entries.delete(firstKey);
      this._evictions++;
    }
  }

  private persistIfEnabled(): void {
    if (!this.config.persistToLocalStorage) return;
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      const pairs = Array.from(this.entries.entries());
      storage.setItem(this.config.storageKey, JSON.stringify(pairs, bigintReplacer));
    } catch {
      // localStorage may be full or unavailable; silently skip.
    }
  }

  private loadFromStorage(): void {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      const raw = storage.getItem(this.config.storageKey);
      if (!raw) return;
      const pairs = JSON.parse(raw, bigintReviver) as Array<[string, CacheEntry<any>]>;
      const now = Date.now();
      for (const [key, entry] of pairs) {
        // Skip entries that have already expired.
        if (entry.expiresAt === 0 || entry.expiresAt > now) {
          this.entries.set(key, entry);
        }
      }
    } catch {
      // Corrupt or schema-incompatible storage — start fresh.
    }
  }

  private clearStorage(): void {
    const storage = getLocalStorage();
    if (!storage) return;
    try {
      storage.removeItem(this.config.storageKey);
    } catch {
      // ignore
    }
  }
}

// ─── JSON BigInt helpers ──────────────────────────────────────────────────────

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getLocalStorage(): StorageLike | undefined {
  try {
    // Works in browsers; undefined in Node / SSR environments.
    const ls = (globalThis as Record<string, unknown>).localStorage;
    return ls as StorageLike | undefined;
  } catch {
    return undefined;
  }
}

function bigintReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return { __bigint: value.toString() };
  return value;
}

function bigintReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === 'object' &&
    '__bigint' in (value as Record<string, unknown>)
  ) {
    return BigInt((value as { __bigint: string }).__bigint);
  }
  return value;
}
