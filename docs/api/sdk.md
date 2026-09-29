# SDK Reference

The TypeScript SDK reference is generated from the TSDoc comments in `sdk/src`
with [TypeDoc](https://typedoc.org/) and
[`typedoc-plugin-markdown`](https://typedoc-plugin-markdown.org/).

The generated pages are **not checked into the repository**. They are produced
at build time from the root `typedoc.json`:

```bash
npm run docs:gen:sdk
```

`npm run docs:build` (and the CI docs job) runs this automatically before the
VitePress build.

## Generated pages

- [Open the generated SDK API reference](/api/sdk/)

The entry point is `bcForgeClient` from `sdk/src/index.ts`. Every write method
builds, simulates, signs, and submits a Soroban invocation; read methods use
simulation only. See [Architecture](/ARCHITECTURE) for how the SDK relates to
the contracts.
