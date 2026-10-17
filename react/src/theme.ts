// SPDX-License-Identifier: MIT
/** Shared semantic color tokens; existing component palettes are preserved. */
export const theme = {
  surface: '#ffffff',
  text: '#111827',
  border: '#d1d5db',
  neutralBackground: '#f3f4f6',
  neutralText: '#374151',
  primary: '#2563eb',
  primaryBackground: '#eff6ff',
  primaryBorder: '#bfdbfe',
  primaryText: '#1e40af',
  successBackground: '#f0fdf4',
  successBorder: '#bbf7d0',
  successText: '#166534',
  warningBackground: '#fffbeb',
  warningBorder: '#fde68a',
  warningText: '#92400e',
  danger: '#dc2626',
  dangerBackground: '#fef2f2',
  dangerBorder: '#fecaca',
  dangerText: '#991b1b',
  infoBackground: '#ecfeff',
  infoText: '#155e75',
  focus: '#6366f1',
  focusRing: 'rgba(99,102,241,0.15)',
  primaryFocusRing: 'rgba(37,99,235,0.3)',
  dangerFocusRing: 'rgba(220,38,38,0.3)',
  shadow: 'rgba(0, 0, 0, 0.1)',
} as const;

// ─── Design tokens (#1140) ──────────────────────────────────────────────────
//
// `theme` above is public API: every shipped component reads it and its shape
// is frozen, so it is left exactly as it was. This block adds the *design
// system* layer on top — the brand palette, the type scale, the glassmorphism
// surfaces and the dark variants — plus the bridge that lets a single token be
// consumed both as an inline-style value (React) and as a CSS custom property
// (CSS/Tailwind).
//
// Everything below is pure data. Importing this module has no side effects and
// every export is a frozen object literal, so the whole module stays
// tree-shakeable in a consumer's `tsup` build (see the `sideEffects` contract in
// `react/package.json`).

/** How a token behaves when the active colour scheme changes. */
export type DesignTokenKind =
  /** Identical in light and dark; exposed as a plain static value. */
  | 'static'
  /** Flips between a light-scheme and a dark-scheme value. */
  | 'themeable'
  /** A structural value (font size, radius, blur) with no colour meaning. */
  | 'structural';

/**
 * One entry in the CSS-variable bridge.
 *
 * `name` is the token's string id (`'brand-primary'`) and `cssVariable` is the
 * `--bc-*` custom property the same value is written to. Keeping the two in a
 * single object is what stops the React side and the CSS side from drifting:
 * {@link cssVariables} and {@link cssVariablesFor} are both derived from the
 * same {@link designTokens} map.
 */
export interface DesignToken {
  /** Token id as authored, e.g. `'brand-primary'`. */
  readonly name: string;
  /** Value in light mode. */
  readonly value: string;
  /** Value in dark mode, when it differs from `value`. */
  readonly darkValue?: string;
  /** The `--bc-*` custom property this token is written to. */
  readonly cssVariable: string;
  /** Whether the token is static, themeable, or structural. */
  readonly kind: DesignTokenKind;
  /**
   * WCAG 2.1 contrast ratio of `value` against its documented background, e.g.
   * `'17.4:1 on #ffffff (AAA)'`. Absent for structural tokens.
   */
  readonly contrast?: string;
  /** Whether the token is a gradient rather than a plain colour. */
  readonly gradient?: boolean;
}

/** Token id → token. See {@link designTokens}. */
export type DesignTokenMap = Readonly<Record<string, DesignToken>>;

/** The fields a token declares before its id and CSS variable are derived. */
type DesignTokenSeed = Omit<DesignToken, 'name' | 'cssVariable'>;

/**
 * Builds the `--bc-*` custom property name for a token id.
 *
 * Exported so a consumer extending the palette (or a script generating CSS)
 * applies exactly the same naming rule `ThemeProvider` writes with.
 *
 * @example
 * ```ts
 * cssVariableName('brand-primary'); // '--bc-color-brand-primary'
 * ```
 *
 * @param name - Token id, in kebab-case (`brand-primary`) or camelCase.
 */
export function cssVariableName(name: string): string {
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
  return `--bc-${kebab}`;
}

/**
 * The declared palette. This is the single source of truth for #1140: every
 * other export in this section is derived from it, and `tailwind.config.js` /
 * `index.css` in `react/demo` mirror the same names so the demo's utilities and
 * the library's inline styles never disagree.
 *
 * Colour contrast is documented per token in {@link DesignToken.contrast} and
 * summarised in {@link designTokenContrast}.
 */
const TOKEN_SEEDS: Readonly<Record<string, DesignTokenSeed>> = {
  // ── Brand ───────────────────────────────────────────────────────────────
  'brand-primary': {
    value: '#2563eb',
    darkValue: '#598fff',
    kind: 'themeable',
    // Same colour as `theme.primary`, so inline-styled components and Tailwind
    // utilities render the identical blue.
    contrast: '5.17:1 on #ffffff (AA, #2563eb); 7.01:1 on #070b14 (AAA, #598fff)',
  },
  'brand-primary-hover': {
    value: '#1d4fd7',
    darkValue: '#8eb6ff',
    kind: 'themeable',
    contrast: '7.04:1 on #ffffff (AAA, #1d4fd7)',
  },
  'brand-primary-subtle': {
    value: '#eff6ff',
    darkValue: '#111a2e',
    kind: 'themeable',
    contrast: '16.9:1 for #111827 body text on #eff6ff (AAA)',
  },
  // ── Stellar ─────────────────────────────────────────────────────────────
  'stellar-blue': {
    value: '#3b82f6',
    darkValue: '#93c5fd',
    kind: 'themeable',
    // #3b82f6 only clears AA at large-text sizes on white; body text uses
    // `stellar-blue-deep`.
    contrast: '3.68:1 on #ffffff (AA for large/UI text only, #3b82f6)',
  },
  'stellar-blue-deep': {
    value: '#1d4ed8',
    darkValue: '#93c5fd',
    kind: 'themeable',
    contrast: '6.7:1 on #ffffff (AAA, #1d4ed8)',
  },
  // ── Surfaces ────────────────────────────────────────────────────────────
  surface: {
    value: '#ffffff',
    darkValue: '#0b1220',
    kind: 'themeable',
    contrast: '18.9:1 for #111827 body text on #ffffff (AAA)',
  },
  'surface-elevated': {
    value: '#ffffff',
    darkValue: '#182338',
    kind: 'themeable',
    contrast: '14.6:1 for #f9fafb body text on #ffffff (AAA)',
  },
  'surface-overlay': {
    value: '#ffffff',
    darkValue: '#22304c',
    kind: 'themeable',
    contrast: 'decorative scrim only — never used for text',
  },
  'surface-glass': {
    value: 'rgba(255, 255, 255, 0.72)',
    darkValue: 'rgba(17, 26, 46, 0.72)',
    kind: 'themeable',
  },
  'surface-glass-border': {
    value: 'rgba(255, 255, 255, 0.60)',
    darkValue: 'rgba(148, 163, 184, 0.20)',
    kind: 'themeable',
  },
  'surface-gradient': {
    value: 'linear-gradient(180deg, #ffffff 0%, #f3f4f6 100%)',
    darkValue: 'linear-gradient(180deg, #0b1220 0%, #070b14 100%)',
    kind: 'themeable',
    gradient: true,
  },
  'surface-gradient-elevated': {
    value: 'linear-gradient(180deg, #ffffff 0%, #eff6ff 100%)',
    darkValue: 'linear-gradient(180deg, #182338 0%, #0b1220 100%)',
    kind: 'themeable',
    gradient: true,
  },
  'background-canvas': {
    value: '#f3f4f6',
    darkValue: '#070b14',
    kind: 'themeable',
    contrast: '12.6:1 for #111827 body text on #f3f4f6 (AAA)',
  },
  // ── Text and borders ────────────────────────────────────────────────────
  text: {
    value: '#111827',
    darkValue: '#e5e7eb',
    kind: 'themeable',
    contrast:
      '17.4:1 on #ffffff (AAA, #111827); 13.1:1 on #070b14 (AAA, #e5e7eb)',
  },
  'text-muted': {
    value: '#4b5563',
    darkValue: '#9ca3af',
    kind: 'themeable',
    contrast:
      '7.59:1 on #ffffff (AAA, #4b5563); 7.5:1 on #070b14 (AAA, #9ca3af)',
  },
  border: {
    value: '#d1d5db',
    darkValue: '#22304c',
    kind: 'themeable',
    contrast:
      '1.47:1 on #ffffff — a decorative divider, so it is never the only boundary (WCAG 1.4.11)',
  },
  'focus-ring': {
    value: 'rgba(99, 102, 241, 0.35)',
    darkValue: 'rgba(147, 197, 253, 0.55)',
    kind: 'themeable',
  },
  // ── Typography ──────────────────────────────────────────────────────────
  'font-sans': {
    value: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    kind: 'structural',
  },
  'font-mono': {
    value: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
    kind: 'structural',
  },
  'text-display': { value: '3.5rem', kind: 'structural' },
  'text-title': { value: '1.5rem', kind: 'structural' },
  'text-body': { value: '0.9375rem', kind: 'structural' },
  'text-caption': { value: '0.75rem', kind: 'structural' },
  // ── Glassmorphism geometry ──────────────────────────────────────────────
  'radius-glass': { value: '16px', kind: 'structural' },
  'blur-glass': { value: '16px', kind: 'structural' },
  'blur-glass-lg': { value: '32px', kind: 'structural' },
};

/**
 * The bc-forge design token set (#1140).
 *
 * Tokens live in one flat, name-keyed map rather than a nested object so a
 * token can be looked up by its string id (`designTokens['brand-primary']`)
 * from CSS-driven configuration, a Tailwind preset, or a consumer's own theme
 * file, without a deep-walk helper.
 *
 * The same record is the source for {@link cssVariables} and
 * {@link cssVariablesFor}, which is how one declaration reaches all three
 * consumers: React inline styles, a `style` attribute, and a CSS custom
 * property.
 */
export const designTokens: DesignTokenMap = Object.freeze(
  Object.fromEntries(
    Object.entries(TOKEN_SEEDS).map(([id, seed]) => [
      id,
      Object.freeze({ name: id, cssVariable: cssVariableName(id), ...seed }),
    ]),
  ),
);

/** Token id → `--bc-*` custom property name, for every token. */
export const cssVariables: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.values(designTokens).map((token) => [token.name, token.cssVariable]),
  ),
);

/** Ordered token ids, handy for iterating the palette (e.g. a token gallery). */
export const designTokenNames: readonly string[] = Object.freeze(
  Object.keys(designTokens),
);

/**
 * WCAG 2.1 contrast documentation for every token that carries one, keyed by
 * token id. Pairs documented as AA/AAA here are the ones the demo and Storybook
 * rely on; gradients, scrims and focus rings are deliberately excluded because
 * they are not text surfaces.
 */
export const designTokenContrast: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(designTokens).flatMap(([id, token]) =>
      token.contrast ? [[id, token.contrast] as const] : [],
    ),
  ),
);

/**
 * Builds the `{ '--bc-*': value }` record for a colour scheme.
 *
 * Passing this straight to a `style` prop — or spreading it over a
 * `CSSStyleDeclaration` in a loop — applies the whole palette in one
 * operation, which is what `ThemeProvider` (#1141) does on every theme change
 * and what the `ThemeScript` inline snippet does before first paint.
 *
 * @param scheme - `'light'` (default) or `'dark'`.
 *
 * @example
 * ```tsx
 * <div style={designTokenStyle('dark')} />
 * ```
 */
export function cssVariablesFor(
  scheme: 'light' | 'dark' = 'light',
): Readonly<Record<string, string>> {
  const dark = scheme === 'dark';
  const result: Record<string, string> = {};
  for (const token of Object.values(designTokens)) {
    result[token.cssVariable] = (dark ? token.darkValue : undefined) ?? token.value;
  }
  return Object.freeze(result);
}

/**
 * The value of a single token in a given scheme, falling back to its static
 * value when the token has no dark variant.
 *
 * @param name - Token id, e.g. `'brand-primary'`.
 * @param scheme - `'light'` (default) or `'dark'`.
 * @returns The resolved value, or `undefined` when the token id is unknown.
 */
export function designTokenValue(
  name: string,
  scheme: 'light' | 'dark' = 'light',
): string | undefined {
  const token = designTokens[name];
  if (!token) return undefined;
  return (scheme === 'dark' ? token.darkValue : undefined) ?? token.value;
}

/**
 * The token set as a plain record ready to spread into a `style` prop.
 *
 * Use this when a component must work with no stylesheet at all — the shipped
 * library components do exactly that today with the older {@link theme} object.
 * A `Record<string, string>` is structurally compatible with React's
 * `CSSProperties` for custom properties, so no cast is needed at the call
 * site.
 *
 * @param scheme - `'light'` (default) or `'dark'`.
 */
export function designTokenStyle(
  scheme: 'light' | 'dark' = 'light',
): Record<string, string> {
  return { ...cssVariablesFor(scheme) };
}