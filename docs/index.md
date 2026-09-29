---
layout: home

hero:
  name: bc-forge
  text: Soroban token platform documentation
  tagline: Contracts, TypeScript SDK, CLI, and the security and operations runbooks.
  actions:
    - theme: brand
      text: Architecture
      link: /ARCHITECTURE
    - theme: alt
      text: SDK Reference
      link: /api/sdk

features:
  - title: Guides
    details: Architecture, access control, admin key hygiene, upgrades, vaults, and a full walkthrough.
  - title: SDK reference
    details: Generated from the TSDoc in sdk/src with TypeDoc at build time.
  - title: Contract reference
    details: Generated from the Rust doc comments with cargo doc at build time.
---

## Building these docs locally

The site lives in `docs/` and is built with VitePress. From the repository
root:

```bash
npm install        # VitePress and TypeDoc are root devDependencies
npm run docs:gen   # generate the SDK and contract API pages
npm run docs:dev   # serve at http://localhost:5173
```

See the repository README for the full instructions.
