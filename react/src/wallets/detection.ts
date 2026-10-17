// SPDX-License-Identifier: MIT
/**
 * Browser wallet feature detection (#1169, #1170).
 *
 * The SDK's `FreighterAdapter` reads `globalThis.freighter` and its
 * `AlbedoAdapter` reads `globalThis.albedo`, so probing those globals *is* the
 * feature probe: whatever this module reports as `installed` is exactly what the
 * matching adapter will find when it connects. Nothing here imports the SDK, and
 * no browser API is touched unless {@link isBrowser} says it exists, so the
 * module is safe to import during server-side rendering.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { WalletName } from '../context';

/** Wallets offered by this package, in the order the UI renders them. */
export const WALLET_NAMES: readonly WalletName[] = ['freighter', 'albedo'];

/** Display label for each supported wallet. */
export const WALLET_LABELS: Readonly<Record<WalletName, string>> = {
  freighter: 'Freighter',
  albedo: 'Albedo',
};

/** Where a visitor is sent to install Freighter (#1169). */
export const FREIGHTER_INSTALL_URL = 'https://www.freighter.app/';

/** Where a visitor is sent to open Albedo in a new tab (#1170). */
export const ALBEDO_INSTALL_URL = 'https://albedo.link/';

/** Extension download page; Albedo ships no extension of its own. */
export const ALBEDO_EXTENSION_URL = 'https://albedo.link/';

/** CDN build of `@albedo-link/intent`, injected on demand (#1170). */
export const ALBEDO_SCRIPT_URL = 'https://albedo.link/intent';

/** How long {@link loadAlbedoScript} waits for the CDN script. @default 10000 */
export const ALBEDO_SCRIPT_TIMEOUT_MS = 10_000;

/** How long the bundled Albedo script waits before self-initialising (#1170). */
export const ALBEDO_INTENT_TIMEOUT_MS = 10_000;

/** Delay between probes of the `albedo` global after the script loads. */
export const ALBEDO_POLL_INTERVAL_MS = 50;

/** Default wait and poll interval for {@link whenFreighterReady}. @default 1000 */
export const FREIGHTER_READY_TIMEOUT_MS = 1_000;

/** `data-bc-forge` attribute identifying a script this module injected. */
export const ALBEDO_SCRIPT_ID = 'bc-forge-albedo-intent';

/** One or more calls the Freighter extension may expose to prove it is alive. */
type FreighterProbeMethod =
  | 'getPublicKey'
  | 'signTransaction'
  | 'getNetwork'
  | 'getNetworkDetails'
  | 'enable';

const FREIGHTER_PROBE_METHODS: readonly FreighterProbeMethod[] = [
  'getPublicKey',
  'signTransaction',
  'getNetwork',
  'getNetworkDetails',
  'enable',
];

const ALBEDO_PROBE_METHODS: readonly (keyof AlbedoIntentApi)[] = [
  'publicKey',
  'signTransaction',
  'signTx',
  'tx',
];

/**
 * Minimal shape of the `window.freighter` API this module probes. Every field
 * is optional: an extension that injects asynchronously exposes them late, and a
 * stale or blocked version may expose none of them.
 */
export interface FreighterExtensionApi {
  getPublicKey?: () => Promise<string | undefined>;
  signTransaction?: (xdr: string, options?: { networkPassphrase?: string }) => Promise<unknown>;
  getNetwork?: () => Promise<unknown>;
  getNetworkDetails?: () => Promise<unknown>;
  enable?: () => Promise<unknown>;
}

/** Minimal shape of the `window.albedo` API this module probes. */
export interface AlbedoIntentApi {
  publicKey?: () => Promise<unknown>;
  signTransaction?: (xdr: string, options?: { network?: string }) => Promise<unknown>;
  signTx?: (xdr: string, options?: { network?: string }) => Promise<unknown>;
  tx?: (options: { xdr: string; network?: string }) => Promise<unknown>;
}

declare global {
  interface Window {
    /** Injected by the Freighter browser extension. */
    freighter?: FreighterExtensionApi;
    /** Injected by the Albedo "intent" script. */
    albedo?: AlbedoIntentApi;
  }
}

/** One row of the wallet picker: a wallet plus what is known about it. */
export interface WalletAvailability {
  /** Adapter name; also the value persisted in the session store. */
  readonly name: WalletName;
  /** Human readable label. */
  readonly label: string;
  /**
   * `true` when the matching SDK adapter will find its global right now.
   * `false` is a UI state, never an error: the wallet simply is not there.
   */
  readonly installed: boolean;
  /** `true` when the wallet only works as a browser extension. */
  readonly requiresExtension: boolean;
  /** Destination of the "install" affordance; `null` when already available. */
  readonly installUrl: string | null;
  /** `true` once {@link loadAlbedoScript} failed for this page. */
  readonly loadFailed: boolean;
}

/** Snapshot of every probed wallet, in render order. */
export interface WalletDetection {
  /** Freighter first, then Albedo — the order the picker renders them in. */
  readonly wallets: readonly WalletAvailability[];
  /** Ids of injected Albedo scripts that this page marked as failed. */
  readonly failedAlbedoScriptIds: readonly string[];
}

/** Result of the Albedo readiness handshake (#1170). */
export interface AlbedoLoadResult {
  /** `true` when a callable `window.albedo` exists after the injection. */
  readonly available: boolean;
  /** Why loading failed, worded for the user; `null` on success. */
  readonly reason: string | null;
}

// ─── Browser guard ──────────────────────────────────────────────────────────

/**
 * Whether a DOM is available. Every helper below starts here, so importing this
 * module under Node (SSR, a plain unit test) neither throws nor reads globals.
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

// ─── Storage primitives (#1172) ─────────────────────────────────────────────

/** An in-memory stand-in used when `localStorage` is unavailable (#1172). */
const memoryStore = new Map<string, string>();

let cachedStorage: Storage | null = null;

/** Scratch key used to find out whether `localStorage` can be written to. */
const STORAGE_PROBE_KEY = 'bc-forge:storage-probe';

/**
 * The usable `localStorage`, or `null`.
 *
 * Reading `window.localStorage` and writing to it can both throw — Safari
 * private mode and "block all cookies" raise a `SecurityError`, and a sandboxed
 * frame raises on access — so the probe writes and removes a scratch key. The
 * result is cached only on success, so a user who re-enables storage is picked
 * up again. Correctness rests on the `try`/`catch` in each caller, not here.
 */
export function getLocalStorage(): Storage | null {
  if (cachedStorage) return cachedStorage;
  if (!isBrowser()) return null;
  try {
    const storage = window.localStorage;
    storage.setItem(STORAGE_PROBE_KEY, '1');
    storage.removeItem(STORAGE_PROBE_KEY);
    cachedStorage = storage;
  } catch {
    cachedStorage = null;
  }
  return cachedStorage;
}

/** Subscribers to storage mutations made through this module (see below). */
const storageSubscribers = new Set<() => void>();

/**
 * Announces a write made through {@link writeStoredValue} or
 * {@link removeStoredValue}. A `StorageEvent` only fires in *other* documents,
 * so the writing document notifies its own subscribers by hand.
 */
function notifyStoredValueChanged(): void {
  if (!isBrowser()) return;
  for (const listener of Array.from(storageSubscribers)) {
    try {
      listener();
    } catch {
      /* A misbehaving subscriber must not break the write that notified it. */
    }
  }
}

/**
 * Reads a string key, falling back to an in-memory store when storage is
 * blocked. Returns `null` rather than throwing, so callers can treat a failed
 * read as "nothing stored" (#1172).
 */
export function readStoredValue(key: string): string | null {
  const storage = getLocalStorage();
  if (storage) {
    try {
      return storage.getItem(key);
    } catch {
      /* Fall through to the in-memory copy. */
    }
  }
  return memoryStore.get(key) ?? null;
}

/**
 * Writes a string key. A blocked store degrades to the in-memory map instead of
 * throwing. Returns whether the value reached a durable store, which is `false`
 * during SSR, in a sandboxed frame, and in private browsing (#1172).
 */
export function writeStoredValue(key: string, value: string): boolean {
  memoryStore.set(key, value);
  const storage = getLocalStorage();
  let persisted = false;
  if (storage) {
    try {
      storage.setItem(key, value);
      persisted = true;
    } catch {
      /* Quota exceeded or storage disabled mid-session; memory copy stands. */
    }
  }
  notifyStoredValueChanged();
  return persisted;
}

/**
 * Removes a key from every store the page can reach. Blocked storage is not an
 * error: the in-memory copy is dropped and the value is gone either way (#1172).
 */
export function removeStoredValue(key: string): void {
  memoryStore.delete(key);
  const storage = getLocalStorage();
  if (storage) {
    try {
      storage.removeItem(key);
    } catch {
      /* The memory copy above is already gone. */
    }
  }
  notifyStoredValueChanged();
}

/**
 * Listens for changes to `keys` made anywhere in the app: the `storage` event
 * from another tab, plus this document's own writes through the helpers above.
 * Returns an unsubscribe function (#1172).
 *
 * A `storage` event with `key === null` is `localStorage.clear()` and is
 * treated as a change to every watched key.
 */
export function subscribeToStoredKeys(keys: readonly string[], listener: () => void): () => void {
  const watched = new Set(keys);
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== null && !watched.has(event.key)) return;
    listener();
  };

  storageSubscribers.add(listener);
  if (isBrowser()) window.addEventListener('storage', handleStorage);

  return () => {
    storageSubscribers.delete(listener);
    if (isBrowser()) window.removeEventListener('storage', handleStorage);
  };
}

// ─── Global probes (#1169, #1170) ───────────────────────────────────────────

function getFreighterGlobal(): unknown {
  return isBrowser() ? (window.freighter as unknown) : undefined;
}

function getAlbedoGlobal(): unknown {
  return isBrowser() ? (window.albedo as unknown) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Whether `value` is a live Freighter API rather than a same-named stub.
 *
 * A truthy global exposing none of the methods the SDK adapter calls belongs to
 * something that is not the extension (a colliding wallet, a half-injected
 * build), so it is reported as *not* installed and the UI offers the install
 * link instead of letting the adapter fail later.
 */
function isUsableFreighter(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (!isRecord(value)) return false;
  return FREIGHTER_PROBE_METHODS.some((method) => typeof value[method] === 'function');
}

/** Whether `value` exposes at least one callable Albedo intent method. */
function isUsableAlbedo(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return ALBEDO_PROBE_METHODS.some((method) => typeof value[method] === 'function');
}

/**
 * Whether the Freighter extension is installed and usable (#1169).
 *
 * Returns `false` — never throws — during server-side rendering, when the
 * extension is absent, and when the global is present but unusable.
 */
export function isFreighterInstalled(): boolean {
  return isUsableFreighter(getFreighterGlobal());
}

/**
 * Whether the Albedo intent script is present and usable (#1170).
 *
 * Returns `false` — never throws — during server-side rendering and while the
 * script has not been loaded.
 */
export function isAlbedoAvailable(): boolean {
  return isUsableAlbedo(getAlbedoGlobal());
}

/** The `@albedo-link/intent` script tags this page has, ours or the app's. */
function getAlbedoScriptTags(): HTMLScriptElement[] {
  if (!isBrowser()) return [];
  return Array.from(document.querySelectorAll('script')).filter((tag) => {
    const src = tag.getAttribute('src') ?? '';
    return tag.getAttribute('data-bc-forge') === ALBEDO_SCRIPT_ID || src === ALBEDO_SCRIPT_URL;
  });
}

/** Ids of injected Albedo scripts this page marked as failed. */
function getFailedAlbedoScriptIds(): string[] {
  return getAlbedoScriptTags()
    .filter((tag) => tag.getAttribute('data-bc-forge-failed') === 'true')
    .map((tag) => tag.getAttribute('data-bc-forge') ?? ALBEDO_SCRIPT_ID);
}

/** Options for {@link whenFreighterReady}. */
export interface WhenFreighterReadyOptions {
  /** Total wait in milliseconds. @default {@link FREIGHTER_READY_TIMEOUT_MS} */
  timeoutMs?: number;
  /** Delay between probes. @default {@link FREIGHTER_READY_TIMEOUT_MS} */
  intervalMs?: number;
  /**
   * Cancels the wait early. A caller that unmounts, or that has already
   * connected some other way, passes an `AbortSignal` so the pending timer does
   * not outlive it.
   */
  signal?: AbortSignal;
}

/**
 * Resolves once the Freighter extension has injected a usable API, or `false`
 * once the budget is spent (#1169).
 *
 * Content scripts inject asynchronously, so a `false` from
 * {@link isFreighterInstalled} read during the first render is not proof that
 * the extension is missing. This polls for a bounded time and never rejects, so
 * callers can `await` it from an effect without a `try`/`catch`.
 */
export function whenFreighterReady(options: WhenFreighterReadyOptions = {}): Promise<boolean> {
  const {
    timeoutMs = FREIGHTER_READY_TIMEOUT_MS,
    intervalMs = FREIGHTER_READY_TIMEOUT_MS,
    signal,
  } = options;

  return new Promise<boolean>((resolve) => {
    if (!isBrowser() || signal?.aborted) {
      resolve(false);
      return;
    }

    let settled = false;
    let remaining = Math.max(0, timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onAbort = () => finish(false);
    function finish(ready: boolean) {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(ready);
    }

    signal?.addEventListener('abort', onAbort);

    const poll = () => {
      if (settled) return;
      if (isFreighterInstalled()) {
        finish(true);
        return;
      }
      if (remaining <= 0) {
        finish(false);
        return;
      }
      const slice = Math.min(intervalMs, remaining);
      remaining -= slice;
      timer = setTimeout(poll, slice);
    };

    poll();
  });
}

// ─── Albedo intent script (#1170) ───────────────────────────────────────────

function createAlbedoScript(timeoutMs: number): HTMLScriptElement {
  const script = document.createElement('script');
  script.src = ALBEDO_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  // The intent script is third-party code: do not leak the page URL to the CDN.
  script.referrerPolicy = 'no-referrer';
  script.setAttribute('data-bc-forge', ALBEDO_SCRIPT_ID);
  // Small bump over our own budget so the script's own self-initialise timeout
  // runs out after ours and its global is always there when we check.
  script.setAttribute('data-albedo-intent', `timeoutMs=${timeoutMs + ALBEDO_INTENT_TIMEOUT_MS}`);
  return script;
}

let albedoLoad: Promise<AlbedoLoadResult> | null = null;

/**
 * Makes `window.albedo` available, injecting the CDN intent script when the page
 * did not load it itself (#1170).
 *
 * Albedo is a web wallet, so "not available" normally means the app's HTML never
 * included the intent script. Loading it lazily here keeps
 * `@albedo-link/intent` out of `package.json` and out of the initial bundle.
 *
 * Concurrent calls share a single in-flight promise, a tag already in the
 * document is adopted rather than duplicated, and every failure path resolves
 * with `available: false` plus a `reason` worded for the user — the function
 * never rejects, so a blocked CDN degrades to "Albedo unavailable" instead of an
 * unhandled rejection. A failed tag records `data-bc-forge-failed`, so later
 * calls report the failure immediately instead of retrying the network on every
 * render.
 */
export function loadAlbedoScript(options: { timeoutMs?: number } = {}): Promise<AlbedoLoadResult> {
  if (albedoLoad) return albedoLoad;
  if (!isBrowser()) {
    return Promise.resolve({ available: false, reason: 'Albedo is only available in a browser.' });
  }
  if (isAlbedoAvailable()) {
    return Promise.resolve({ available: true, reason: null });
  }

  const timeoutMs = options.timeoutMs ?? ALBEDO_SCRIPT_TIMEOUT_MS;
  const [failedTag] = getFailedAlbedoScriptIds();
  const existing = failedTag
    ? undefined
    : getAlbedoScriptTags().find((tag) => tag.getAttribute('data-bc-forge-failed') !== 'true');

  if (failedTag) {
    return Promise.resolve({
      available: false,
      reason: `Could not load the Albedo wallet from ${ALBEDO_SCRIPT_URL}.`,
    });
  }

  albedoLoad = new Promise<AlbedoLoadResult>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let budget = Math.max(0, timeoutMs);
    let settled = false;

    const script = existing ?? createAlbedoScript(timeoutMs);

    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
    const settle = (available: boolean, reason: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!available) script.setAttribute('data-bc-forge-failed', 'true');
      // Allow a later call to retry explicitly, but keep this promise so
      // concurrent callers still share one result.
      albedoLoad = null;
      resolve({ available, reason });
    };
    function onLoad() {
      poll();
    }
    function onError() {
      settle(false, `Could not load the Albedo wallet from ${ALBEDO_SCRIPT_URL}.`);
    }

    // The script can fire `load` before it self-initialises, so poll for the
    // global instead of trusting the event alone.
    const poll = () => {
      if (settled) return;
      if (isAlbedoAvailable()) {
        settle(true, null);
        return;
      }
      if (budget <= 0) {
        settle(false, `Albedo did not become available within ${timeoutMs}ms.`);
        return;
      }
      const slice = Math.min(ALBEDO_POLL_INTERVAL_MS, budget);
      budget -= slice;
      timer = setTimeout(poll, slice);
    };

    script.addEventListener('load', onLoad);
    script.addEventListener('error', onError);
    if (!existing) document.head.appendChild(script);
    poll();
  });

  return albedoLoad;
}

// ─── Aggregate detection (#1169, #1170) ─────────────────────────────────────

/** Per-wallet facts that do not change at runtime. */
const WALLET_FACTS: Readonly<
  Record<WalletName, { requiresExtension: boolean; installUrl: string }>
> = {
  freighter: { requiresExtension: true, installUrl: FREIGHTER_INSTALL_URL },
  albedo: { requiresExtension: false, installUrl: ALBEDO_INSTALL_URL },
};

function buildAvailability(
  name: WalletName,
  installed: boolean,
  loadFailed: boolean,
): WalletAvailability {
  const facts = WALLET_FACTS[name];
  return {
    name,
    label: WALLET_LABELS[name],
    installed,
    requiresExtension: facts.requiresExtension,
    installUrl: installed ? null : facts.installUrl,
    loadFailed,
  };
}

/**
 * Probes every supported wallet and returns the rows the picker renders
 * (#1169, #1170).
 *
 * A synchronous snapshot, deliberately: it only reads globals, so it is safe to
 * call inside an effect on first paint and safe to call during server-side
 * rendering, where every row simply reports `installed: false`.
 */
export function detectWallets(): WalletDetection {
  const failedAlbedoScriptIds = getFailedAlbedoScriptIds();
  const albedoFailed = failedAlbedoScriptIds.length > 0;

  return {
    wallets: WALLET_NAMES.map((name) => {
      const installed = name === 'freighter' ? isFreighterInstalled() : isAlbedoAvailable();
      return buildAvailability(name, installed, name === 'albedo' && albedoFailed);
    }),
    failedAlbedoScriptIds,
  };
}

/** Immutable "nothing detected" snapshot, used as the server-rendering seed. */
const EMPTY_DETECTION: WalletDetection = {
  wallets: WALLET_NAMES.map((name) => buildAvailability(name, false, false)),
  failedAlbedoScriptIds: [],
};

/**
 * Live wallet availability for the picker (#1169, #1170).
 *
 * The first render reads synchronously, so a browser that already has the
 * extension shows the right badges on the first paint; the hook then re-probes
 * once per mount to pick up an extension that injects late. Call `refresh()` to
 * probe again — the picker does exactly that after
 * {@link loadAlbedoScript} succeeds.
 *
 * `detecting` is `true` while a probe is in flight, so the UI can keep showing
 * the previous badges instead of flashing. It starts as `false` because the
 * first render already probed.
 *
 * The returned `wallets` array is stable between probes: it only changes when
 * `refresh()` resolves with different results.
 */
export function useWalletDetection(): WalletDetection & {
  /** `true` while a re-probe is running. */
  readonly detecting: boolean;
  /** Runs a fresh probe; resolves once it has been applied. */
  readonly refresh: () => Promise<void>;
} {
  const [detection, setDetection] = useState<WalletDetection>(() =>
    isBrowser() ? detectWallets() : EMPTY_DETECTION,
  );
  const [detecting, setDetecting] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setDetecting(true);
    // Yield once so the pending state paints and a synchronous re-probe cannot
    // be collapsed into a single render.
    await Promise.resolve();
    const next = detectWallets();
    if (!mounted.current) return;
    setDetection(next);
    setDetecting(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...detection, detecting, refresh };
}