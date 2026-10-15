// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  ALBEDO_SCRIPT_URL,
  FREIGHTER_INSTALL_URL,
  detectWallets,
  isAlbedoAvailable,
  isBrowser,
  isFreighterInstalled,
  isWalletName,
  loadAlbedoScript,
  onWalletSessionChange,
  readStoredValue,
  removeStoredValue,
  subscribeToStoredKeys,
  useWalletDetection,
  whenFreighterReady,
  writeStoredValue,
} from './index';

/** A `window.freighter` shaped like the real extension. */
function fakeFreighter() {
  return { getPublicKey: jest.fn().mockResolvedValue('GABC') };
}

/** A `window.albedo` shaped like the real intent script. */
function fakeAlbedo() {
  return { publicKey: jest.fn().mockResolvedValue('GABC') };
}

function clearInjectedScripts(): void {
  document.querySelectorAll('script[data-bc-forge]').forEach((tag) => tag.remove());
}

describe('browser guard', () => {
  it('reports a DOM as available under jsdom', () => {
    expect(isBrowser()).toBe(true);
  });
});

describe('Freighter detection (#1169)', () => {
  afterEach(() => {
    delete (window as { freighter?: unknown }).freighter;
  });

  it('reports the extension as absent when the global is missing', () => {
    expect(isFreighterInstalled()).toBe(false);
  });

  it('reports the extension as present once it exposes its API', () => {
    (window as { freighter?: unknown }).freighter = fakeFreighter();
    expect(isFreighterInstalled()).toBe(true);
  });

  it('treats a truthy but unusable global as not installed', () => {
    // Another extension could own the name; the SDK adapter needs a real method.
    (window as { freighter?: unknown }).freighter = { nothing: true };
    expect(isFreighterInstalled()).toBe(false);
  });

  it('never throws when the probe runs', () => {
    (window as { freighter?: unknown }).freighter = null;
    expect(() => isFreighterInstalled()).not.toThrow();
    expect(isFreighterInstalled()).toBe(false);
  });

  it('resolves once an asynchronously injected extension shows up', async () => {
    const ready = whenFreighterReady({ timeoutMs: 500, intervalMs: 5 });
    setTimeout(() => {
      (window as { freighter?: unknown }).freighter = fakeFreighter();
    }, 10);

    await expect(ready).resolves.toBe(true);
  });

  it('gives up after the budget and resolves false', async () => {
    await expect(whenFreighterReady({ timeoutMs: 20, intervalMs: 5 })).resolves.toBe(false);
  });

  it('can be cancelled with an AbortSignal', async () => {
    const controller = new AbortController();
    const ready = whenFreighterReady({ timeoutMs: 5_000, intervalMs: 5, signal: controller.signal });
    controller.abort();
    await expect(ready).resolves.toBe(false);
  });

  it('resolves false immediately for an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      whenFreighterReady({ signal: controller.signal, timeoutMs: 5_000 }),
    ).resolves.toBe(false);
  });
});

describe('Albedo detection (#1170)', () => {
  afterEach(() => {
    delete (window as { albedo?: unknown }).albedo;
    clearInjectedScripts();
  });

  it('reports the intent script as absent until it is loaded', () => {
    expect(isAlbedoAvailable()).toBe(false);
  });

  it('reports the intent script as present once it exposes its API', () => {
    (window as { albedo?: unknown }).albedo = fakeAlbedo();
    expect(isAlbedoAvailable()).toBe(true);
  });

  it('treats a truthy but unusable global as unavailable', () => {
    (window as { albedo?: unknown }).albedo = { unrelated: 1 };
    expect(isAlbedoAvailable()).toBe(false);
  });
});

describe('loadAlbedoScript (#1170)', () => {
  afterEach(() => {
    delete (window as { albedo?: unknown }).albedo;
    clearInjectedScripts();
  });

  it('resolves without injecting anything when the global already exists', async () => {
    (window as { albedo?: unknown }).albedo = fakeAlbedo();
    const result = await loadAlbedoScript();

    expect(result).toEqual({ available: true, reason: null });
    expect(document.querySelectorAll(`script[src="${ALBEDO_SCRIPT_URL}"]`)).toHaveLength(0);
  });

  it('injects the CDN script once and resolves when the global appears', async () => {
    const pending = loadAlbedoScript({ timeoutMs: 500 });

    const injected = document.querySelector<HTMLScriptElement>(
      `script[src="${ALBEDO_SCRIPT_URL}"]`,
    );
    expect(injected).not.toBeNull();
    expect(injected?.async).toBe(true);
    expect(injected?.referrerPolicy).toBe('no-referrer');

    (window as { albedo?: unknown }).albedo = fakeAlbedo();
    injected?.dispatchEvent(new Event('load'));

    await expect(pending).resolves.toEqual({ available: true, reason: null });
  });

  it('shares one in-flight promise across concurrent calls', async () => {
    const first = loadAlbedoScript({ timeoutMs: 500 });
    const second = loadAlbedoScript({ timeoutMs: 500 });

    expect(second).toBe(first);

    const injected = document.querySelector<HTMLScriptElement>(
      `script[src="${ALBEDO_SCRIPT_URL}"]`,
    );
    (window as { albedo?: unknown }).albedo = fakeAlbedo();
    injected?.dispatchEvent(new Event('load'));

    await Promise.all([first, second]);
    expect(document.querySelectorAll(`script[src="${ALBEDO_SCRIPT_URL}"]`)).toHaveLength(1);
  });

  it('resolves false with a reason when the script errors, without throwing', async () => {
    const pending = loadAlbedoScript({ timeoutMs: 500 });
    const injected = document.querySelector<HTMLScriptElement>(
      `script[src="${ALBEDO_SCRIPT_URL}"]`,
    );

    expect(() => injected?.dispatchEvent(new Event('error'))).not.toThrow();
    const result = await pending;

    expect(result.available).toBe(false);
    expect(result.reason).toContain(ALBEDO_SCRIPT_URL);
  });

  it('gives up when the script loads but never defines the global', async () => {
    const pending = loadAlbedoScript({ timeoutMs: 30 });
    document
      .querySelector<HTMLScriptElement>(`script[src="${ALBEDO_SCRIPT_URL}"]`)
      ?.dispatchEvent(new Event('load'));

    const result = await pending;
    expect(result.available).toBe(false);
    expect(result.reason).toContain('did not become available');
  });

  it('remembers a failure instead of retrying on every call', async () => {
    const failed = loadAlbedoScript({ timeoutMs: 500 });
    document
      .querySelector<HTMLScriptElement>(`script[src="${ALBEDO_SCRIPT_URL}"]`)
      ?.dispatchEvent(new Event('error'));
    await failed;

    // The failed tag is still in the document; no second tag is appended.
    const again = await loadAlbedoScript();
    expect(again.available).toBe(false);
    expect(document.querySelectorAll(`script[src="${ALBEDO_SCRIPT_URL}"]`)).toHaveLength(1);
  });
});

describe('detectWallets (#1169, #1170)', () => {
  afterEach(() => {
    delete (window as { freighter?: unknown }).freighter;
    delete (window as { albedo?: unknown }).albedo;
    clearInjectedScripts();
  });

  it('returns Freighter then Albedo, both missing, with install links', () => {
    const { wallets } = detectWallets();

    expect(wallets.map((wallet) => wallet.name)).toEqual(['freighter', 'albedo']);
    expect(wallets.every((wallet) => !wallet.installed)).toBe(true);
    expect(wallets[0].installUrl).toBe(FREIGHTER_INSTALL_URL);
    expect(wallets[0].requiresExtension).toBe(true);
    // Albedo is a web wallet: it is available through a script, not an extension.
    expect(wallets[1].requiresExtension).toBe(false);
  });

  it('drops the install link for a detected wallet', () => {
    (window as { freighter?: unknown }).freighter = fakeFreighter();
    const freighter = detectWallets().wallets[0];

    expect(freighter.installed).toBe(true);
    expect(freighter.installUrl).toBeNull();
  });
});

describe('storage primitives', () => {
  afterEach(() => {
    removeStoredValue('bc-forge:test');
  });

  it('round-trips a value through localStorage', () => {
    expect(writeStoredValue('bc-forge:test', 'value')).toBe(true);
    expect(readStoredValue('bc-forge:test')).toBe('value');
  });

  it('returns null for a key that was never written', () => {
    expect(readStoredValue('bc-forge:missing')).toBeNull();
  });

  it('notifies subscribers of writes made in this document', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToStoredKeys(['bc-forge:test'], listener);

    writeStoredValue('bc-forge:test', 'value');
    expect(listener).toHaveBeenCalledTimes(1);

    removeStoredValue('bc-forge:test');
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    writeStoredValue('bc-forge:test', 'again');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('ignores storage events for keys it does not own', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToStoredKeys(['bc-forge:test'], listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'someone-else' }));
    expect(listener).not.toHaveBeenCalled();

    window.dispatchEvent(new StorageEvent('storage', { key: 'bc-forge:test' }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('treats a cleared store as a change', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToStoredKeys(['bc-forge:test'], listener);

    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('subscribes through the wallet-facing helper', () => {
    const listener = jest.fn();
    const unsubscribe = onWalletSessionChange(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: 'bc-forge:wallet-session' }));
    expect(listener).toHaveBeenCalled();

    unsubscribe();
  });
});

describe('useWalletDetection (#1169, #1170)', () => {
  afterEach(() => {
    delete (window as { freighter?: unknown }).freighter;
  });

  function DetectionProbe() {
    const { wallets, refresh } = useWalletDetection();
    return (
      <div>
        <span data-testid="installed">
          {wallets.filter((wallet) => wallet.installed).map((wallet) => wallet.name).join(',') ||
            'none'}
        </span>
        <button type="button" onClick={() => void refresh()}>
          refresh
        </button>
      </div>
    );
  }

  it('seeds from a synchronous probe and picks up a late extension', async () => {
    render(<DetectionProbe />);
    expect(screen.getByTestId('installed')).toHaveTextContent('none');

    (window as { freighter?: unknown }).freighter = fakeFreighter();
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));

    await waitFor(() => {
      expect(screen.getByTestId('installed')).toHaveTextContent('freighter');
    });
  });
});

describe('isWalletName', () => {
  it('accepts the supported wallets and rejects everything else', () => {
    expect(isWalletName('freighter')).toBe(true);
    expect(isWalletName('albedo')).toBe(true);
    expect(isWalletName('lobstr')).toBe(false);
    expect(isWalletName(42)).toBe(false);
    expect(isWalletName(null)).toBe(false);
  });
});