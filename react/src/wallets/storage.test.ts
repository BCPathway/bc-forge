// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';

import {
  WALLET_PREFERENCE_KEY,
  WALLET_SESSION_KEY,
  clearWalletSession,
  loadStoredWalletPreference,
  loadWalletPreference,
  loadWalletSession,
  onWalletSessionChange,
  saveWalletPreference,
  saveWalletSession,
} from './storage';

function resetStorage(): void {
  window.localStorage.clear();
}

describe('wallet session persistence (#1172)', () => {
  beforeEach(() => {
    resetStorage();
  });

  afterEach(() => {
    resetStorage();
  });

  it('reports no session before anything is saved', () => {
    expect(loadWalletSession()).toBeNull();
    expect(loadWalletPreference()).toBeNull();
  });

  it('round-trips the wallet name and the network it was saved on', () => {
    expect(saveWalletSession('freighter', 'Test SDF Network ; September 2015')).toBe(true);

    expect(loadWalletSession()).toEqual({
      wallet: 'freighter',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });
  });

  it('omits the network when none was supplied', () => {
    saveWalletSession('albedo');

    expect(loadWalletSession()).toEqual({ wallet: 'albedo' });
  });

  it('writes only the wallet name, never a public key', () => {
    saveWalletSession('freighter', 'Test SDF Network ; September 2015');
    const raw = window.localStorage.getItem(WALLET_SESSION_KEY);

    expect(raw).not.toBeNull();
    expect(raw).not.toMatch(/^G[A-Z0-9]{20,}/);
    expect(Object.keys(JSON.parse(raw as string)).sort()).toEqual([
      'networkPassphrase',
      'wallet',
    ]);
  });

  it('clears the session so the next load does not restore it', () => {
    saveWalletSession('albedo');
    clearWalletSession();

    expect(loadWalletSession()).toBeNull();
  });

  it('discards a corrupted value instead of throwing', () => {
    window.localStorage.setItem(WALLET_SESSION_KEY, '{not json');

    expect(() => loadWalletSession()).not.toThrow();
    expect(loadWalletSession()).toBeNull();
  });

  it('discards a hand-edited wallet this build does not know', () => {
    window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify({ wallet: 'lobstr' }));

    expect(loadWalletSession()).toBeNull();
  });

  it('discards a truncated value', () => {
    window.localStorage.setItem(WALLET_SESSION_KEY, 'null');
    expect(loadWalletSession()).toBeNull();

    window.localStorage.setItem(WALLET_SESSION_KEY, '"albedo"');
    expect(loadWalletSession()).toEqual({ wallet: 'albedo' });
  });

  it('tolerates a bare wallet name written by hand', () => {
    window.localStorage.setItem(WALLET_SESSION_KEY, 'freighter');
    expect(loadWalletSession()).toEqual({ wallet: 'freighter' });
  });

  it('refuses to persist a wallet it does not recognise', () => {
    // The signature only accepts a `WalletName`; this guards the runtime too.
    expect(saveWalletSession('lobstr' as unknown as 'freighter')).toBe(false);
    expect(loadWalletSession()).toBeNull();
  });
});

describe('wallet preference', () => {
  beforeEach(() => {
    resetStorage();
  });

  afterEach(() => {
    resetStorage();
  });

  it('is stored under its own key', () => {
    saveWalletPreference('albedo');

    expect(window.localStorage.getItem(WALLET_PREFERENCE_KEY)).toContain('albedo');
    expect(loadStoredWalletPreference()).toBe('albedo');
  });

  it('falls back to the session wallet when no preference was saved', () => {
    saveWalletSession('freighter');
    expect(loadStoredWalletPreference()).toBe('freighter');
  });

  it('ignores a corrupted preference', () => {
    window.localStorage.setItem(WALLET_PREFERENCE_KEY, 'garbage');
    saveWalletSession('albedo');

    expect(loadStoredWalletPreference()).toBe('albedo');
  });

  it('leaves the session alone when the preference is cleared', () => {
    saveWalletSession('freighter');
    window.localStorage.removeItem(WALLET_PREFERENCE_KEY);

    expect(loadStoredWalletPreference()).toBe('freighter');
  });
});

describe('onWalletSessionChange (#1172)', () => {
  beforeEach(() => {
    resetStorage();
  });

  afterEach(() => {
    resetStorage();
  });

  it('fires for writes made in this document', () => {
    const listener = jest.fn();
    const unsubscribe = onWalletSessionChange(listener);

    saveWalletSession('freighter');
    expect(listener).toHaveBeenCalledTimes(1);

    clearWalletSession();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it('fires for a change made in another tab', () => {
    const listener = jest.fn();
    const unsubscribe = onWalletSessionChange(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: WALLET_SESSION_KEY }));
    expect(listener).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-app-key' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});

describe('when localStorage is unavailable (#1172)', () => {
  let setItem: ReturnType<typeof jest.spyOn>;
  let getItem: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    // Safari private mode and blocked-cookie settings both raise on access.
    setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled');
    });
    getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage is disabled');
    });
  });

  afterEach(() => {
    setItem.mockRestore();
    getItem.mockRestore();
  });

  it('degrades to an in-memory session instead of crashing', () => {
    expect(() => saveWalletSession('freighter', 'Test SDF Network ; September 2015')).not.toThrow();
    expect(saveWalletSession('freighter', 'Test SDF Network ; September 2015')).toBe(false);

    expect(loadWalletSession()).toEqual({
      wallet: 'freighter',
      networkPassphrase: 'Test SDF Network ; September 2015',
    });

    clearWalletSession();
    expect(loadWalletSession()).toBeNull();
  });
});