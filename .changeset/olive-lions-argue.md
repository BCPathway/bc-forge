---
'@bc-forge/react': minor
---

Add a `ThemeProvider` with `useTheme()` managing light/dark/system preference via `localStorage` and `prefers-color-scheme`, plus an inline `ThemeScript` that applies the theme before first paint so there is no flash of unstyled content (#1141). `theme.ts` gains a `designTokens` map and a CSS-variable bridge so the same brand palette, Stellar blue, glassmorphism surfaces, and dark-mode variants are reachable as inline styles, Tailwind utilities, and `--bc-*` custom properties (#1140). The demo is wired to Vite path aliases with Soroban chunk splitting (#1139) and Storybook gains dark-mode, viewport, and mocked-Web3 decorators (#1144).