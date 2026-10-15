---
'@bc-forge/react': minor
---

Add the `Modal` dialog primitive (#1149), multi-network switching on `BcForgeProvider` via `useNetwork` (#1148), and enforce strict TypeScript plus error-level ESLint rules across `react/src` (#1145). The demo harness now validates its environment variables with zod and renders a configuration error screen instead of failing silently (#1146).