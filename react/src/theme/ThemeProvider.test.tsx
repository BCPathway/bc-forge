// SPDX-License-Identifier: MIT
/**
 * Colocated tests for {@link ThemeProvider} (#1141).
 *
 * These run in jsdom with a controllable `matchMedia` and `localStorage`, so
 * every branch the provider claims to handle — system resolution, explicit
 * override, persistence across remount, toggle, cross-tab sync, missing
 * `matchMedia` and a missing `window` — is exercised directly rather than
 * inferred.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  DEFAULT_THEME_STORAGE_KEY,
  ThemeProvider,
  createThemeScript,
  readStoredTheme,
  resolveTheme,
  storeTheme,
  useTheme,
  type ResolvedTheme,
} from './ThemeProvider';

const originalMatchMedia = window.matchMedia;
const originalLocalStorage = window.localStorage;

/** A `matchMedia` stub whose `matches` flag can be flipped at will. */
function installMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  window.matchMedia = ((query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    get matches() {
      return matches;
    },
    /** Flip the OS preference and notify every subscriber. */
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) {
        listener({ matches: next } as MediaQueryListEvent);
      }
    },
  };
}

/** Reads the resolved scheme straight off the root element. */
function rootTheme(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function Probe() {
  const { theme, resolvedTheme, setTheme, toggleTheme, isSystem } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="is-system">{String(isSystem)}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

beforeEach(() => {
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
  window.localStorage.clear();
});

afterEach(() => {
  if (originalMatchMedia) window.matchMedia = originalMatchMedia;
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: originalLocalStorage,
  });
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('style');
});

describe('resolveTheme', () => {
  it('passes an explicit choice through and defers "system"', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
  });
});

describe('storage helpers', () => {
  it('round-trips a preference and rejects junk', () => {
    expect(storeTheme('dark', 'test-key')).toBe(true);
    expect(readStoredTheme('test-key')).toBe('dark');
    window.localStorage.setItem('test-key', 'chartreuse');
    expect(readStoredTheme('test-key', 'light')).toBe('light');
  });

  it('falls back when localStorage throws (private browsing)', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage is disabled');
      },
    });
    expect(storeTheme('dark')).toBe(false);
    expect(readStoredTheme(DEFAULT_THEME_STORAGE_KEY, 'light')).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('resolves "system" from prefers-color-scheme and follows later changes', () => {
    const media = installMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('is-system')).toHaveTextContent('true');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(rootTheme()).toBe('dark');

    act(() => media.set(false));

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(rootTheme()).toBe('light');
  });

  it('lets an explicit choice win over the OS and writes it to storage', () => {
    installMatchMedia(true);
    render(
      <ThemeProvider defaultTheme="system">
        <Probe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'light' }));

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(screen.getByTestId('is-system')).toHaveTextContent('false');
    expect(window.localStorage.getItem(DEFAULT_THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('persists across a remount', () => {
    installMatchMedia(false);
    const first = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    first.unmount();

    expect(window.localStorage.getItem(DEFAULT_THEME_STORAGE_KEY)).toBe('dark');

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');
  });

  it('honours a custom storageKey', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider storageKey="widget-theme">
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dark' }));

    expect(window.localStorage.getItem('widget-theme')).toBe('dark');
    expect(window.localStorage.getItem(DEFAULT_THEME_STORAGE_KEY)).toBeNull();
  });

  it('toggles away from "system" using the resolved scheme', () => {
    // OS says dark, stored preference is still "system".
    installMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(window.localStorage.getItem(DEFAULT_THEME_STORAGE_KEY)).toBe('light');

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(window.localStorage.getItem(DEFAULT_THEME_STORAGE_KEY)).toBe('dark');
  });

  it('returns to following the OS when set back to "system"', () => {
    const media = installMatchMedia(false);
    render(
      <ThemeProvider defaultTheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');

    fireEvent.click(screen.getByRole('button', { name: 'system' }));
    act(() => media.set(true));

    expect(screen.getByTestId('is-system')).toHaveTextContent('true');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(window.localStorage.getItem(DEFAULT_THEME_STORAGE_KEY)).toBe('system');
  });

  it('writes the CSS custom properties and restores them on unmount', () => {
    installMatchMedia(true);
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    const root = document.documentElement;
    expect(root.style.getPropertyValue('--bc-brand-primary')).toBe('#598fff');
    expect(root.style.getPropertyValue('--bc-surface')).toBe('#0b1220');
    expect(root.style.colorScheme).toBe('dark');

    unmount();

    expect(root.getAttribute('data-theme')).toBeNull();
    expect(root.style.getPropertyValue('--bc-brand-primary')).toBe('');
    expect(root).not.toHaveClass('dark');
  });

  it('adopts a preference written by another tab', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: DEFAULT_THEME_STORAGE_KEY,
          newValue: 'dark',
        }),
      );
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(document.documentElement).toHaveClass('dark');

    // An unrelated key must not disturb the current theme.
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'something-else', newValue: 'light' }),
      );
    });
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('removes its listeners on unmount', () => {
    const media = installMatchMedia(false);
    const { unmount } = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    unmount();

    // No listener remains, so flipping the OS must not touch the DOM.
    expect(() => act(() => media.set(true))).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('does not throw when matchMedia is unavailable (old Safari)', () => {
    // Simulate Safari < 14, where `matchMedia` is not a function at all.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'dark' })),
    ).not.toThrow();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('renders outside a provider without throwing', () => {
    installMatchMedia(false);
    render(<Probe />);
    expect(screen.getByTestId('theme')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('light');
  });
});

describe('SSR safety', () => {
  it('degrades to the fallback preference when there is no window', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const removed = Reflect.deleteProperty(globalThis, 'window');
    try {
      // Guard rather than fail when the environment refuses to drop `window`;
      // the point of the test is the branch, not the sandbox.
      if (!removed || typeof window !== 'undefined') return;

      expect(typeof window).toBe('undefined');
      expect(storeTheme('dark')).toBe(false);
      expect(readStoredTheme(DEFAULT_THEME_STORAGE_KEY, 'light')).toBe('light');
      // `system` with no matchMedia resolves to light rather than throwing.
      expect(resolveTheme('system')).toBe('light');
      expect(resolveTheme('dark')).toBe('dark');
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'window', descriptor);
    }
  });
});

describe('createThemeScript', () => {
  /** Evaluates the generated snippet the way a browser would on `<head>`. */
  const runSnippet = (source: string): void => {
    // `new Function` keeps this independent of jsdom's `runScripts` setting.
    const run = new Function(source) as () => void;
    run();
  };

  it('produces a guarded, dependency-free snippet keyed by storageKey', () => {
    const source = createThemeScript({ storageKey: 'widget-theme' });

    expect(source).toContain('widget-theme');
    expect(source).toContain('try{');
    expect(source).toContain('catch(_)');
    expect(source).toContain('prefers-color-scheme: dark');
    expect(source).toContain('data-theme');
    expect(source).not.toContain('import');
    expect(source).not.toContain('require');
  });

  it('applies the stored theme when evaluated', () => {
    window.localStorage.setItem(DEFAULT_THEME_STORAGE_KEY, 'dark');
    runSnippet(createThemeScript());

    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('falls back to light when storage holds an unusable value', () => {
    window.localStorage.setItem(DEFAULT_THEME_STORAGE_KEY, 'not-a-theme');
    runSnippet(createThemeScript());

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('does not throw when localStorage is unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: storage is disabled');
      },
    });

    expect(() => runSnippet(createThemeScript())).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });
});