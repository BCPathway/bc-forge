# Changelog

## 1.1.0

### Minor Changes

- 8f3380d: Add a `ThemeProvider` with `useTheme()` managing light/dark/system preference via `localStorage` and `prefers-color-scheme`, plus an inline `ThemeScript` that applies the theme before first paint so there is no flash of unstyled content (#1141). `theme.ts` gains a `designTokens` map and a CSS-variable bridge so the same brand palette, Stellar blue, glassmorphism surfaces, and dark-mode variants are reachable as inline styles, Tailwind utilities, and `--bc-*` custom properties (#1140). The demo is wired to Vite path aliases with Soroban chunk splitting (#1139) and Storybook gains dark-mode, viewport, and mocked-Web3 decorators (#1144).
- b829c82: Add four accessible UI-kit primitives: `Pagination` with page-window truncation and a page-size selector (#1165), `MetricCard`/`MetricStatBox` with trend colours and a loading skeleton (#1166), `ConfirmationDialog` with a checkbox-or-keyword gate for destructive actions (#1167), and `EmptyState` for zero-result tables and search results (#1168). All four are inline-styled from the existing theme tokens, fully keyboard operable, and exported from the package root.
- a3071d5: Add the `Modal` dialog primitive (#1149), multi-network switching on `BcForgeProvider` via `useNetwork` (#1148), and enforce strict TypeScript plus error-level ESLint rules across `react/src` (#1145). The demo harness now validates its environment variables with zod and renders a configuration error screen instead of failing silently (#1146).
- f13e4b7: Harden the wallet connection layer: SSR-safe detection for the Freighter extension including a bounded readiness handshake (#1169), lazy loading of the Albedo intent script as an extension-free fallback (#1170), a `WalletSelectModal` with per-wallet install badges and links (#1171), and `localStorage` session persistence that silently reconnects across reloads while reusing the existing network-passphrase validation (#1172). `useWallet()` gains additive `connectWallet`, `availableWallets`, and `restoring` fields; existing consumers are unaffected.

## 1.0.1

### Patch Changes

- Updated dependencies [dc13c55]
  - @bc-forge/sdk@0.2.0

All notable changes to `@bc-forge/react` are documented here.

## [1.0.0] - 2026-09-29

### Breaking

- No breaking changes in this initial public React package release.

### Features

- Initial public `@bc-forge/react` release with provider and hook utilities for the bc-forge SDK.
- Add package-local changelog entries so release notes can describe React-only changes without mixing in unrelated components.

### Fixes

- Ensure the GitHub release body can include only the React section, keeping release notes scoped to the selected component.

### Migrations

- No migration is required for existing consumers of the React package.
