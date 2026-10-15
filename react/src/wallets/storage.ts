// SPDX-License-Identifier: MIT
/**
 * `localStorage` persistence for the wallet session (#1172).
 *
 * Only two things are stored, both namespaced so a host app can clear them:
 *
 * - {@link WALLET_SESSION_KEY} — the wallet the user actually connected with,
 *   written once a connection succeeds. It is what makes a reload reconnect.
 * - {@link WALLET_PREFERENCE_KEY} — the wallet last offered in the picker, so
 *   the modal can preselect it even before a connection exists.
 *
 * Never written: secret keys, signers, or a public key. A public key stored
 * across reloads is stale the moment the user switches accounts, and pretending
 * otherwise would leave the UI claiming a connection the page no longer holds —
 * the real key is always re-read from the adapter on reconnect.
 *
 * Every access is wrapped: Safari private mode, a sandboxed frame, and a
 * "block all cookies" setting all throw on `localStorage`, and a hand-edited or
 * truncated value is not a wallet name. Both cases degrade to "nothing stored"
 * rather than an exception.
 */
import {
  WALLET_NAMES,
  isBrowser,
  readStoredValue,
  removeStoredValue,
  subscribeToStoredKeys,
  writeStoredValue,
} from './detection';
import type { WalletName } from '../context';

/** localStorage key holding the wallet the user connected with (#1172). */
export const WALLET_SESSION_KEY = 'bc-forge:wallet-session';

/** localStorage key holding the wallet last offered in the picker (#1172). */
export const WALLET_PREFERENCE_KEY = 'bc-forge:wallet-preference';

/** Every key this module owns; watched by {@link onWalletSessionChange}. */
const WALLET_STORAGE_KEYS: readonly string[] = [WALLET_SESSION_KEY, WALLET_PREFERENCE_KEY];

/** What {@link saveWalletSession} records. */
export interface WalletSession {
  /**
   * The connected wallet. The only field persisted: the public key is
   * re-obtained from the adapter on reconnect because it can change between
   * page loads.
   */
  readonly wallet: WalletName;
  /**
   * Stellar network passphrase the app is deployed against. Recorded so a
   * restored session can be checked against the live configuration instead of
   * being trusted blindly. Informational — it never overrides the provider's
   * `networkPassphrase`, which is the authority.
   */
  readonly networkPassphrase?: string;
}

/**
 * Narrows an unknown value to a {@link WalletName}.
 *
 * Anything hand-edited, stale from an older release, or written by another
 * library is rejected here rather than deep inside the provider, so a corrupted
 * value can never reach `connect`.
 */
export function isWalletName(value: unknown): value is WalletName {
  return typeof value === 'string' && (WALLET_NAMES as readonly string[]).includes(value);
}

function parseSession(raw: string): WalletSession | null {
  // Tolerate the bare-name form a hand edit (or an older build) might leave.
  if (isWalletName(raw)) return { wallet: raw };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const record = parsed as { wallet?: unknown; networkPassphrase?: unknown };
  if (!isWalletName(record.wallet)) return null;

  return {
    wallet: record.wallet,
    networkPassphrase:
      typeof record.networkPassphrase === 'string' ? record.networkPassphrase : undefined,
  };
}

/**
 * Reads the persisted wallet session (#1172).
 *
 * Returns `null` when nothing is stored, when storage is unavailable, when the
 * JSON is malformed, or when the stored wallet is not one this build supports.
 * Callers therefore only ever branch on "there is a session worth restoring"
 * versus "there is not".
 */
export function loadWalletSession(): WalletSession | null {
  if (!isBrowser()) return null;
  const raw = readStoredValue(WALLET_SESSION_KEY);
  if (raw === null) return null;
  return parseSession(raw);
}

/**
 * Reads just the wallet name, for the case where the network is not needed
 * (for example preselecting a row in the picker). Returns `null` whenever
 * {@link loadWalletSession} would.
 */
export function loadWalletPreference(): WalletName | null {
  return loadWalletSession()?.wallet ?? null;
}

/**
 * Persists the connected wallet so the next page load can reconnect (#1172).
 *
 * Called after a successful connect — never before — so a failed handshake or a
 * user rejection leaves nothing behind to restore.
 *
 * Returns whether the value reached a durable store; `false` means storage is
 * blocked and the session will not survive a reload, which is not an error.
 */
export function saveWalletSession(wallet: WalletName, networkPassphrase?: string): boolean {
  if (!isWalletName(wallet) || !isBrowser()) return false;
  const session: WalletSession =
    networkPassphrase === undefined ? { wallet } : { wallet, networkPassphrase };
  return writeStoredValue(WALLET_SESSION_KEY, JSON.stringify(session));
}

/**
 * Forgets the connected wallet. Called on an explicit disconnect, on a failed
 * connect, and when a restored session turns out to be unusable (the extension
 * was uninstalled, say) so the stale entry cannot be retried on every load.
 */
export function clearWalletSession(): void {
  if (!isBrowser()) return;
  removeStoredValue(WALLET_SESSION_KEY);
}

/**
 * Records the wallet the user picked, independently of whether the handshake
 * succeeded, so the picker can preselect it next time even if they cancelled.
 */
export function saveWalletPreference(wallet: WalletName): boolean {
  if (!isWalletName(wallet) || !isBrowser()) return false;
  return writeStoredValue(WALLET_PREFERENCE_KEY, JSON.stringify({ wallet }));
}

/**
 * Reads {@link WALLET_PREFERENCE_KEY}. Falls back to the session's wallet when
 * only a session was saved.
 */
export function loadStoredWalletPreference(): WalletName | null {
  if (!isBrowser()) return null;
  const raw = readStoredValue(WALLET_PREFERENCE_KEY);
  if (raw !== null) {
    const preference = parseSession(raw);
    if (preference) return preference.wallet;
  }
  return loadWalletPreference();
}

/**
 * Subscribes to wallet session changes (#1172).
 *
 * Fires when another tab connects or disconnects — the `storage` event — and
 * when this document writes through this module. Returns an unsubscribe
 * function, and is a no-op outside the browser.
 */
export function onWalletSessionChange(listener: () => void): () => void {
  if (!isBrowser()) return () => {};
  return subscribeToStoredKeys(WALLET_STORAGE_KEYS, listener);
}