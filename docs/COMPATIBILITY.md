# Compatibility Matrix

This document describes the runtime, tooling, and package versions supported by
the current `bc-forge` repository.

The ranges below are derived from the package manifests and the repository
contribution requirements. They are not independent version recommendations.

## Runtime and Tooling

| Tool | Supported version | Source |
| --- | --- | --- |
| Node.js | `18+` | `CONTRIBUTING.md` |
| Rust | `1.74+` | `CONTRIBUTING.md` |
| WebAssembly target | `wasm32-unknown-unknown` | `CONTRIBUTING.md` |
| Stellar CLI | `22.0+` | `CONTRIBUTING.md` |

The repository contribution guide requires Node.js 18+, Rust 1.74+, the
`wasm32-unknown-unknown` target, and Stellar CLI 22.0+. The same prerequisites
are listed in the root README.

## Package Compatibility

| Package | Current version | Node.js | Stellar SDK | Package dependencies / peer requirements |
| --- | --- | --- | --- | --- |
| `@bc-forge/sdk` | `0.1.0` | `>=18.0.0` | `^16.0.1` | — |
| `@bc-forge/cli` | `0.1.0` | `>=18.0.0` | `^17.1.0` | `@bc-forge/sdk: *` |
| `@bc-forge/react` | `1.0.0` | Repository prerequisite: `18+` | `^16.0.1` | `@bc-forge/sdk: ^0.1.0`; `react: ^18.0.0 || ^19.0.0`; `react-dom: ^18.0.0 || ^19.0.0` |
| `@bc-forge/indexer` | `1.0.0` | Repository prerequisite: `18+` | `^16.0.1` | `@bc-forge/sdk: ^0.1.0`; `prisma` / `@prisma/client`: `^5.10.0` |

### Notes

- `@bc-forge/sdk` declares Node.js `>=18.0.0` directly in its package
  manifest.
- `@bc-forge/cli` declares Node.js `>=18.0.0` directly in its package
  manifest.
- `@bc-forge/react` does not declare a Node.js `engines` field, so the
  repository-wide Node.js 18+ prerequisite applies to development and tooling.
- `@bc-forge/indexer` does not declare a Node.js `engines` field, so the
  repository-wide Node.js 18+ prerequisite applies to development and runtime
  use.
- The CLI currently declares `@bc-forge/sdk` as `*`; this matrix preserves that
  manifest range rather than introducing an undocumented restriction.
- React consumers must provide React and React DOM compatible with
  `^18.0.0 || ^19.0.0`.
- The React package expects `@bc-forge/sdk` in the `^0.1.0` range.
- The CLI currently uses Stellar SDK `^17.1.0`, while the SDK, React, and
  indexer use Stellar SDK `^16.0.1`. These ranges are intentionally shown
  separately.
- Stellar CLI 22.0+ is required for the repository's contract tooling and
  generated SDK bindings.

## Stellar Tooling

The repository uses the Stellar CLI for Soroban contract tooling and TypeScript
binding generation.

For generated SDK bindings, the contributor guide requires Stellar CLI 22.0+
and the Rust `wasm32-unknown-unknown` target.

From the `sdk/` directory:

```bash
npm run generate:bindings
```