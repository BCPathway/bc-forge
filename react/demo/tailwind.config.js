// SPDX-License-Identifier: MIT
/**
 * Tailwind CSS v3 configuration for the bc-forge demo (#1140).
 *
 * The values in `theme.extend` are a *mirror* of `designTokens` in
 * `react/src/theme.ts` — the one place the brand palette is defined. They are
 * repeated here because Tailwind config files are evaluated in Node and cannot
 * import the library's TypeScript module directly; `src/index.css` is the bridge
 * that keeps the two in agreement at runtime (see the `@layer base` block that
 * reads the `--bc-*` custom properties written by `ThemeProvider`).
 *
 * Keeping the *static* values here and the *switchable* values in CSS custom
 * properties is deliberate:
 *
 *   - static tokens    → a Tailwind utility (`bg-brand-primary`);
 *   - switchable tokens → `var(--bc-surface)`, flipped by
 *     `[data-theme="dark"]` with no rebuild.
 *
 * Anything that has to change with the theme belongs in the second group, not
 * here.
 */
const path = require('node:path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  /**
   * `darkMode: ['class', '[data-theme="dark"]']` compiles the `dark:` variant
   * whenever `<html>` carries *either* the `dark` class or a
   * `data-theme="dark"` attribute. `ThemeProvider` (#1141) writes both, and
   * the inline no-FOUC `ThemeScript` writes only the attribute — so the
   * attribute form is what keeps the very first paint correct before React
   * hydrates.
   */
  darkMode: ['class', '[data-theme="dark"]'],

  /**
   * `content` must list every file that can contain a class name.
   *
   * The library components currently style themselves with inline styles (see
   * `react/src/components/COMPONENTS.md`), but they are scanned anyway so a
   * utility added to a component is compiled the moment it is written instead
   * of silently rendering as an unstyled element.
   */
  content: [
    // The demo's own sources.
    path.join(__dirname, 'src/**/*.{ts,tsx,html}'),
    path.join(__dirname, 'index.html'),
    // The published library (`@bc-forge/react`, `@bc-forge/ui`).
    path.join(__dirname, '../src/**/*.{ts,tsx}'),
    // Storybook stories and the Storybook config itself.
    path.join(__dirname, '../stories/**/*.{ts,tsx}'),
    path.join(__dirname, '../.storybook/**/*.{ts,tsx}'),
  ],

  /**
   * Leave Tailwind's defaults alone — only add the bc-forge tokens. Callers of
   * `@bc-forge/react` get the full default scale (spacing, breakpoints,
   * shadows) plus these.
   */
  theme: {
    extend: {
      colors: {
        /**
         * bc-forge brand ramp. The 600 step is the interactive default and is
         * the same colour as `theme.primary` in `react/src/theme.ts`, so an
         * inline-styled component and a Tailwind utility agree.
         */
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8eb6ff',
          400: '#598fff',
          500: '#3366ff',
          600: '#2563eb',
          700: '#1d4fd7',
          800: '#1e42ad',
          900: '#1e3a87',
        },
        /** Stellar blue — network/explorer accents. */
        stellar: {
          300: '#93c5fd',
          500: '#3b82f6',
          700: '#1d4ed8',
          DEFAULT: '#3b82f6',
        },
        /**
         * Dark surfaces. `ink` is the page background, `elevated` the raised
         * card and `overlay` the scrim behind a modal. Matches the
         * `surfaceDark` family in `designTokens`.
         */
        ink: {
          900: '#070b14',
          800: '#0b1220',
          700: '#111a2e',
          600: '#182338',
          500: '#22304c',
        },
        /** Focus ring colour; identical to `theme.focus`. */
        ring: '#6366f1',
      },

      /**
       * Type scale. Tailwind ships `xs`…`9xl`; `display` is the one the brand
       * adds, matching `typography.display` in `designTokens`.
       */
      fontSize: {
        display: ['3.5rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
      },

      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },

      /**
       * Glassmorphism. `backdrop-blur` is applied by the `.surface-glass`
       * component class in `index.css`; these radii and the shared shadow are
       * what the per-surface blur widths layer on top of.
       */
      borderRadius: {
        glass: '16px',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(2, 6, 23, 0.24)',
        'glass-lg': '0 24px 64px rgba(2, 6, 23, 0.32)',
        focus: '0 0 0 3px rgba(99, 102, 241, 0.35)',
      },

      /**
       * Dark surface gradients. Both are `background-image` values, so they
       * are used as `bg-surface-gradient` / `bg-surface-gradient-elevated`
       * rather than as a colour.
       *
       * The `.surface-gradient*` component classes in `src/index.css` read the
       * `--bc-surface-gradient*` custom properties instead, which is what makes
       * a runtime theme switch animate rather than need a rebuild.
       */
      backgroundImage: {
        'surface-gradient':
          'linear-gradient(180deg, #0b1220 0%, #070b14 100%)',
        'surface-gradient-elevated':
          'linear-gradient(180deg, #182338 0%, #0b1220 100%)',
        'brand-gradient': 'linear-gradient(135deg, #2563eb 0%, #6366f1 100%)',
      },

      /**
       * `screens` is deliberately left at Tailwind's defaults.
       *
       * It is tempting to add `dark: { raw: '[data-theme="dark"]' }` here, but
       * that would register a *screen* called `dark`, colliding with the `dark:`
       * **variant** generated by the `darkMode` option above and producing a
       * duplicate class name. The `darkMode` array already covers both the
       * `.dark` class and the `[data-theme="dark"]` attribute, which is all the
       * variant needs.
       */
    },
  },

  /**
   * Nothing in this project is generated from a class name, so the default
   * safelist is not needed. Kept explicit and empty so adding one later is a
   * deliberate, visible change.
   */
  safelist: [],

  plugins: [],
};