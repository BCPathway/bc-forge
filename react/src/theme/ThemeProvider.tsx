// SPDX-License-Identifier: MIT
/**
 * Theme provider: light / dark / system colour-scheme management (#1141).
 *
 * This module owns four things, and they are deliberately kept together:
 *
 *   1. **The context and hook** — {@link ThemeProvider}, {@link useTheme}.
 *   2. **The DOM side-effect** — writing the `dark` class, `data-theme`,
 *      `color-scheme` and every `--bc-*` custom property onto the root
 *      element, and restoring the previous values on unmount.
 *   3. **The no-FOUC inline script** — {@link createThemeScript}, which must be
 *      serialisable into a `<head>` tag *before* React loads.
 *   4. **The pure helpers** — resolution and persistence logic, exported so they
 *      can be unit-tested without a DOM and reused by the script generator.
 *
 * Everything degrades to a no-op when there is no `window` (SSR), when
 * `localStorage` throws (Safari private browsing, disabled storage) or when
 * `matchMedia` is unavailable (Safari < 14). Nothing here throws.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cssVariablesFor } from '../theme';

/**
 * The preference a consumer stores: an explicit choice, or `'system'` to defer
 * to `prefers-color-scheme`.
 */
export type Theme = 'light' | 'dark' | 'system';

/** The concrete scheme actually applied to the document. Never `'system'`. */
export type ResolvedTheme = 'light' | 'dark';

/** `localStorage` key used when {@link ThemeProviderProps.storageKey} is unset. */
export const DEFAULT_THEME_STORAGE_KEY = 'bc-forge-theme';

/** Class added to `<html>` while the resolved scheme is dark. */
export const DARK_CLASS = 'dark';

/** Attribute added to `<html>` carrying the resolved scheme. */
export const THEME_ATTRIBUTE = 'data-theme';

// ─── Pure helpers ───────────────────────────────────────────────────────────

/** Narrows an unknown stored value to a {@link Theme}, or `null` if invalid. */
function parseTheme(value: string | null | undefined): Theme | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null;
}

/** Whether `matchMedia` is usable in this environment. */
function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/** Reads the OS colour-scheme preference, defaulting to light. */
function systemTheme(): ResolvedTheme {
  if (!hasMatchMedia()) return 'light';
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Resolves a stored preference into the scheme to render.
 *
 * Pure: it reads the system preference through {@link systemTheme} rather than
 * touching any other state, so the same function serves the provider, the
 * tests, and (conceptually) the inline script.
 *
 * @param theme - The stored preference.
 * @param system - The resolved system scheme; injected so this stays testable.
 */
export function resolveTheme(
  theme: Theme,
  system: ResolvedTheme = systemTheme(),
): ResolvedTheme {
  return theme === 'system' ? system : theme;
}

/**
 * Reads the persisted preference.
 *
 * @param storageKey - `localStorage` key to read.
 * @param fallback - Value to use when storage is unavailable or empty.
 * @returns The stored {@link Theme}, or `fallback`.
 */
export function readStoredTheme(
  storageKey: string = DEFAULT_THEME_STORAGE_KEY,
  fallback: Theme = 'system',
): Theme {
  if (typeof window === 'undefined') return fallback;
  try {
    return parseTheme(window.localStorage.getItem(storageKey)) ?? fallback;
  } catch {
    // Private browsing and blocked storage both throw on access.
    return fallback;
  }
}

/**
 * Persists a preference.
 *
 * Never throws: a full or unavailable quota silently degrades to "the theme
 * still applies for this page view, it just is not remembered".
 *
 * @param theme - The preference to remember.
 * @param storageKey - `localStorage` key to write.
 * @returns `true` when the value was persisted.
 */
export function storeTheme(
  theme: Theme,
  storageKey: string = DEFAULT_THEME_STORAGE_KEY,
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(storageKey, theme);
    return true;
  } catch {
    return false;
  }
}

// ─── The inline no-FOUC script ──────────────────────────────────────────────

/**
 * Builds the blocking `<script>` that applies the stored theme before the first
 * paint (#1141).
 *
 * `ThemeProvider` can only run after React has loaded and hydrated, which leaves
 * a window in which the browser has already painted the page in the default
 * scheme. That window is the classic "flash of unstyled content". Inlining this
 * snippet in `<head>` closes it: the class and `data-theme` are set while the
 * document is still parsing, so the first frame is already correct.
 *
 * Properties of the generated snippet, all of which matter:
 *
 *   - **dependency free** — no imports, no bundler output, so it works from a
 *     static `<head>` on any server or CDN;
 *   - **tiny** — a few hundred bytes gzipped;
 *   - **guarded** — the whole body is in a `try`/`catch`, so a hardened browser
 *     (no `localStorage`, no `matchMedia`) simply gets the light default;
 *   - **CSS-variable bridge aware** — the snippet sets `data-theme` and the
 *     `dark` class, and the stylesheet in `react/demo/src/index.css` reacts to
 *     *both*, so the token values are correct even though the script does not
 *     ship the whole palette inline.
 *
 * Render it with {@link ThemeScript} (which is what the demo does) or inline the
 * result yourself if your framework requires a raw string in `<head>`.
 *
 * @param options.storageKey - Must match the provider's `storageKey`.
 * @returns A self-invoking JavaScript source string, safe to inline in HTML.
 */
export function createThemeScript(
  options: { storageKey?: string } = {},
): string {
  const storageKey = JSON.stringify(options.storageKey ?? DEFAULT_THEME_STORAGE_KEY);
  return `(function(){try{var k=${storageKey};var p=window.localStorage.getItem(k);if(p!=="light"&&p!=="dark"&&p!=="system"){p="system"}var d=p==="dark"||(p==="system"&&typeof window.matchMedia==="function"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.setAttribute("data-theme",d?"dark":"light");e.style.colorScheme=d?"dark":"light"}catch(_){}})();`;
}

// ─── DOM application ────────────────────────────────────────────────────────

/** The exact set of values the provider wrote, so unmount can undo them. */
interface AppliedTheme {
  hadDarkClass: boolean;
  themeAttribute: string | null;
  /** `color-scheme` before the provider overwrote it; `''` when it was unset. */
  colorScheme: string;
  /** `--bc-*` value before the provider overwrote it. */
  previousVariables: Map<string, string>;
}

function readElement(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}

/**
 * Writes the scheme onto the root element and records what it changed.
 *
 * Split out from the effect so the exact list of touched properties is visible
 * in one place — and so unmount can put every one of them back.
 */
function applyTheme(
  resolved: ResolvedTheme,
  variables: Readonly<Record<string, string>>,
): AppliedTheme | null {
  const element = readElement();
  if (!element) return null;

  const hadDarkClass = element.classList.contains(DARK_CLASS);
  const themeAttribute = element.getAttribute(THEME_ATTRIBUTE);
  const colorScheme = element.style.colorScheme;
  const previousVariables = new Map<string, string>();

  element.classList.toggle(DARK_CLASS, resolved === 'dark');
  element.setAttribute(THEME_ATTRIBUTE, resolved);
  element.style.colorScheme = resolved;

  for (const [name, value] of Object.entries(variables)) {
    previousVariables.set(name, element.style.getPropertyValue(name));
    element.style.setProperty(name, value);
  }

  return {
    hadDarkClass,
    themeAttribute,
    colorScheme,
    previousVariables,
  };
}

/** Puts back everything {@link applyTheme} overwrote. */
function restoreTheme(applied: AppliedTheme | null): void {
  const element = readElement();
  if (!element || !applied) return;

  if (applied.hadDarkClass) element.classList.add(DARK_CLASS);
  else element.classList.remove(DARK_CLASS);

  if (applied.themeAttribute === null) element.removeAttribute(THEME_ATTRIBUTE);
  else element.setAttribute(THEME_ATTRIBUTE, applied.themeAttribute);

  element.style.colorScheme = applied.colorScheme;

  for (const [name, value] of applied.previousVariables) {
    if (value === '') element.style.removeProperty(name);
    else element.style.setProperty(name, value);
  }
}

// ─── Context ────────────────────────────────────────────────────────────────

/** Value published by {@link ThemeProvider} and read by {@link useTheme}. */
export interface ThemeContextValue {
  /** The stored preference; `'system'` means "follow the OS". */
  theme: Theme;
  /** The scheme actually in effect. */
  resolvedTheme: ResolvedTheme;
  /** Replace the preference. An explicit value is persisted. */
  setTheme: (theme: Theme) => void;
  /** Flip between light and dark, resolving `'system'` first. */
  toggleTheme: () => void;
  /**
   * `true` when the preference is `'system'`. The OS scheme keeps changing
   * underneath the provider while this is set, and `resolvedTheme` follows it
   * live.
   */
  isSystem: boolean;
}

/**
 * The theme context.
 *
 * Exported so a consumer can build a custom provider (a settings sheet, a test
 * harness, a Storybook decorator) on top of it. Prefer {@link useTheme}.
 *
 * The default value is the light/system default rather than `null`, so a
 * component rendered outside a provider degrades to "follow the system" instead
 * of throwing.
 */
export const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  resolvedTheme: 'light',
  setTheme: () => {},
  toggleTheme: () => {},
  isSystem: true,
});

/** Props accepted by {@link ThemeProvider}. */
export interface ThemeProviderProps {
  /** The tree that should inherit the theme. */
  children: ReactNode;
  /**
   * Initial preference used when `localStorage` holds nothing.
   *
   * @default 'system'
   */
  defaultTheme?: Theme;
  /**
   * `localStorage` key for the persisted preference. Change it to support two
   * independent themes in one origin (e.g. an embedded widget).
   *
   * @default 'bc-forge-theme'
   */
  storageKey?: string;
}

/**
 * Provides the light/dark/system colour scheme to the tree and keeps the root
 * `<html>` element in sync with it (#1141).
 *
 * Behaviour, in the order it matters:
 *
 *   - the initial preference comes from `localStorage`, falling back to
 *     `defaultTheme`;
 *   - `'system'` resolves through `matchMedia('(prefers-color-scheme: dark)')`
 *     and **keeps listening**, so flipping the OS theme re-themes the page
 *     without a reload;
 *   - an explicit `light`/`dark` choice is written back to `localStorage` and
 *     stops following the OS until the user returns to `'system'`;
 *   - a `storage` event from another tab is adopted, so every open tab stays in
 *     sync;
 *   - the resolved scheme is written to `<html>` as the `dark` class, the
 *     `data-theme` attribute, `color-scheme` and every `--bc-*` custom property,
 *     and the previous values are restored when the provider unmounts.
 *
 * Nothing here can throw: no `window` (SSR), a throwing `localStorage`
 * (private browsing), a missing `matchMedia` (old Safari) and a read-only
 * `document` all fall back to sensible defaults.
 *
 * For a page that must not flash the wrong theme before hydration, also inline
 * {@link ThemeScript} (or {@link createThemeScript}) in `<head>`.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  defaultTheme = 'system',
  storageKey = DEFAULT_THEME_STORAGE_KEY,
}) => {
  // Reading storage during the first render (rather than in an effect) is what
  // makes the very first React paint match the theme the inline script applied.
  const [theme, setThemeState] = useState<Theme>(() =>
    readStoredTheme(storageKey, defaultTheme),
  );

  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  /** Subscribe to OS scheme changes; a no-op where `matchMedia` is missing. */
  useEffect(() => {
    if (!hasMatchMedia()) return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const onChange = (event: MediaQueryListEvent) => {
      setSystem(event.matches ? 'dark' : 'light');
    };
    setSystem(query.matches ? 'dark' : 'light');

    // Safari < 14 only has the deprecated `addListener`/`removeListener`.
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    }
    if (typeof query.addListener === 'function') {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return;
  }, []);

  /** Keep other tabs of the same origin in sync. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKey) return;
      const next = parseTheme(event.newValue);
      if (next) setThemeState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [storageKey]);

  const resolvedTheme = resolveTheme(theme, system);

  /** Apply the scheme to `<html>` and undo it on unmount. */
  useEffect(() => {
    const applied = applyTheme(resolvedTheme, cssVariablesFor(resolvedTheme));
    return () => restoreTheme(applied);
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      storeTheme(next, storageKey);
    },
    [storageKey],
  );

  const toggleTheme = useCallback(() => {
    // Resolve `'system'` to what is actually on screen before flipping, so the
    // first click from a dark OS lands on light. The write is a side effect and
    // deliberately lives outside the state updater, which must stay pure.
    const next: Theme = resolveTheme(theme, system) === 'dark' ? 'light' : 'dark';
    setThemeState(next);
    storeTheme(next, storageKey);
  }, [storageKey, system, theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      toggleTheme,
      isSystem: theme === 'system',
    }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

/**
 * Reads the theme state published by {@link ThemeProvider}.
 *
 * Outside a provider it returns the default (`'system'` preference, light
 * scheme, no-op actions) rather than throwing, so a component that merely wants
 * to read the scheme can be rendered in isolation.
 *
 * @throws Never.
 *
 * @example
 * ```tsx
 * const { resolvedTheme, toggleTheme } = useTheme();
 * return <button onClick={toggleTheme}>Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'}</button>;
 * ```
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Props accepted by {@link ThemeScript}. */
export interface ThemeScriptProps {
  /**
   * Must match {@link ThemeProviderProps.storageKey}. A mismatch is harmless
   * but means the pre-paint theme and the provider can disagree.
   *
   * @default 'bc-forge-theme'
   */
  storageKey?: string;
}

/**
 * Renders the blocking no-FOUC script from {@link createThemeScript}.
 *
 * React 19 hoists `<script>` elements with a `src`; a plain inline `<script>`
 * with children is rendered where it sits, which is exactly what a `<head>`
 * snippet needs. Mount it in the document `<head>` (Next.js `app/layout.tsx`,
 * Remix `root.tsx`, or a plain `index.html`) *before* the bundle that mounts
 * {@link ThemeProvider}.
 *
 * The provider stays the source of truth: this only makes the first frame match
 * it, and the two agree because both read the same `storageKey`.
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * <head>
 *   <ThemeScript />
 * </head>
 * ```
 */
export const ThemeScript: React.FC<ThemeScriptProps> = ({ storageKey }) => (
  <script
    // The content is a build-time constant with no user input, but React still
    // wants an explicit marker for anything shaped like a script payload.
    dangerouslySetInnerHTML={{ __html: createThemeScript({ storageKey }) }}
  />
);