---
'@bc-forge/react': minor
---

Harden the wallet connection layer: SSR-safe detection for the Freighter extension including a bounded readiness handshake (#1169), lazy loading of the Albedo intent script as an extension-free fallback (#1170), a `WalletSelectModal` with per-wallet install badges and links (#1171), and `localStorage` session persistence that silently reconnects across reloads while reusing the existing network-passphrase validation (#1172). `useWallet()` gains additive `connectWallet`, `availableWallets`, and `restoring` fields; existing consumers are unaffected.