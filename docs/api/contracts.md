# Contract Reference

The Soroban contract reference is generated from the Rust doc comments with
`cargo doc` and served as static rustdoc HTML.

The generated HTML is **not checked into the repository**. It is produced at
build time from the repository root:

```bash
npm run docs:gen:contracts   # cargo doc, then copy into docs/public/api/contracts
```

`npm run docs:build` (and the CI docs job) runs this automatically before the
VitePress build. The HTML is copied into `docs/public/api/contracts/` and is
served by VitePress at `/api/contracts/`.

## Generated pages

- [Open the generated contract reference](/api/contracts/index.html)

Crates documented: the `contracts/*` workspace members (token, admin, lifecycle,
rate-limit, ttl, vesting, wrapper, split, and others present in the workspace).
See [Architecture](/ARCHITECTURE) for how they fit together.
