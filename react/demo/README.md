# bc-forge React Demo

A Vite app that mounts all exported React screens on hash routes so they can be
browsed manually and driven by Playwright end-to-end tests.

## Hash routes

| Route       | Screen              |
| ----------- | ------------------- |
| `#/`        | Connect Control     |
| `#/mint`    | Mint Screen         |
| `#/transfer`| Transfer Screen     |
| `#/burn`    | Burn Screen         |
| `#/roles`   | Roles Screen        |
| `#/vaults`  | Vaults Screen       |

> Screens that are not yet implemented render a labelled placeholder so this
> harness can merge first and be replaced screen-by-screen as each lands.

## Environment variables

Create a `.env` file inside `react/demo/` (or set the variables in your shell)
before starting the dev server or running e2e tests.

Every variable is validated on boot by `src/config.ts` (zod, #1146). Unset
variables fall back to the public testnet values shown below, so a fresh clone
runs with no `.env` at all. A variable that is **set but malformed** — a
relative RPC URL, a blank passphrase, a contract id that is not a `C…` strkey —
stops the demo and renders a configuration error screen instead of a broken
page. The screen lists each problem with the value that was received, what is
expected and how to fix it, plus a copy-pasteable `.env` template.

| Variable                   | Required | Description                                          |
| -------------------------- | -------- | ---------------------------------------------------- |
| `VITE_RPC_URL`             | No       | Soroban RPC endpoint. Defaults to the public testnet.|
| `VITE_NETWORK_PASSPHRASE`  | No       | Network passphrase. Defaults to testnet passphrase.  |
| `VITE_CONTRACT_ID`         | No       | Deployed token/vault contract ID.                    |
| `VITE_WALLET_ADDRESS`      | No       | Stellar address pre-filled as the connected wallet.  |
| `VITE_TOKEN_NAME`          | No       | Display name used by the mock provider.              |
| `VITE_TOKEN_SYMBOL`        | No       | Token symbol used by the mock provider.              |

Validation rules:

| Variable                  | Rule                                                                |
| ------------------------- | ------------------------------------------------------------------- |
| `VITE_RPC_URL`            | Absolute `http://` or `https://` URL with a host.                   |
| `VITE_NETWORK_PASSPHRASE` | Non-blank; must match the endpoint and the wallet's network.        |
| `VITE_CONTRACT_ID`        | Matches `^C[A-Z0-9]{55}$`.                                          |

`loadConfig(env)` returns a discriminated result — `{ ok: true, config }` or
`{ ok: false, issues }` — and never throws, so the app can render the error
screen. `describeConfigError(issues)` renders the same problems as plain text
for a console or a CI step.

Example `.env`:

```env
VITE_RPC_URL=https://soroban-testnet.stellar.org
VITE_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
VITE_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
VITE_WALLET_ADDRESS=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

## Running the demo

```sh
# from the react/demo directory
npm install
npm run dev
```

The app starts on `http://localhost:5173`.

## Module aliases (#1139)

Every alias is declared **once**, in [`aliases.ts`](./aliases.ts), and consumed
by [`vite.config.ts`](./vite.config.ts) and by `react/.storybook/main.ts`.
TypeScript cannot execute code in a JSON file, so the matching
`compilerOptions.paths` block lives in [`tsconfig.demo.json`](./tsconfig.demo.json),
which [`tsconfig.json`](./tsconfig.json) extends.

| Specifier           | Resolves to             | Notes                                        |
| ------------------- | ----------------------- | -------------------------------------------- |
| `@bc-forge/react`   | `react/src/index.ts`    | The published barrel, from source — no build step. |
| `@bc-forge/ui`      | `react/src/components`  | Shared UI components; also `@bc-forge/ui/Badge`, `@bc-forge/ui/Alert`, … |
| `@demo`             | `react/demo/src`        | Demo-local modules, e.g. `@demo/Nav`.        |

The three must stay in step. If you add an alias to `aliases.ts`, add the same
mapping to the `paths` block in `tsconfig.demo.json`, or the editor will flag an
import the bundler resolves (or the reverse).

## Tailwind and design tokens (#1140)

Tailwind v3 is wired in through the classic two-file setup:

| File                                | Role                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| [`tailwind.config.js`](./tailwind.config.js) | Token mirror + `content` globs (demo, `react/src`, `react/stories`). |
| [`postcss.config.js`](./postcss.config.js)     | `tailwindcss` + `autoprefixer`.                       |
| [`src/index.css`](./src/index.css)  | `@tailwind` directives, `--bc-*` custom properties, glassmorphism and dark-gradient classes. |

The token *values* live in [`react/src/theme.ts`](../src/theme.ts) — the same
module the library components read — so a Tailwind utility, an inline style, and
a CSS custom property can never disagree:

```ts
import { designTokens, cssVariablesFor } from '@bc-forge/react';

designTokens['brand-primary'].value; // '#2563eb'
cssVariablesFor('dark');             // { '--bc-brand-primary': '#598fff', … }
```

Every text/background pair is documented with its WCAG 2.1 contrast ratio on
the token itself and summarised in `designTokenContrast`. Body text pairs are
AAA; `--bc-border` is a decorative divider and is never the only boundary.

## Theme switching (#1141)

`App.tsx` mounts the library's `ThemeProvider`, which writes the `dark` class,
`data-theme`, `color-scheme` and every `--bc-*` custom property onto `<html>`,
persisting the choice to `localStorage` and following
`prefers-color-scheme` while the preference is `'system'`.

To avoid a flash of the wrong theme, [`index.html`](./index.html) inlines the
same snippet `createThemeScript()` from the library produces. It runs while the
document is still parsing, so the first paint is already correct. **Keep the
`storageKey` in the two places in step** — they are both `bc-forge-theme`.

## Production build and bundle budget (#1139)

```sh
npm run build     # emits dist/ plus dist/.vite/manifest.json
npm run preview   # serves the build on http://127.0.0.1:4173
```

The build splits the heavy Soroban/RPC dependency out of the initial chunk:

| Chunk        | Contents                                                   |
| ------------ | ---------------------------------------------------------- |
| `soroban`    | `@stellar/stellar-sdk` and everything nested inside it.     |
| `react`      | `react`, `react-dom`, `scheduler`.                          |
| `vendor`     | Everything else under `node_modules`.                       |
| `index`      | App code plus the library sources (aliased, so inlined).     |

After each build a one-line report prints the total uncompressed size of the
**initial** chunks against the 200 kB budget from the issue's AC. For the full
graph, run Rollup's visualizer on top of the same config:

```sh
npx vite-bundle-visualizer            # interactive treemap
# or, machine-readable, with no extra install:
npx vite build && cat dist/.vite/manifest.json
```

`build.chunkSizeWarningLimit` is 250 kB: loud enough to catch a regression that
folds the SDK back into the entry chunk, quiet enough that the deliberately
large `soroban` chunk does not warn on every build.

## Running e2e tests

From the **`react/`** directory (not `react/demo/`):

```sh
npm run e2e
```

This command:

1. Starts the Vite demo server (port 5173).
2. Runs all Playwright specs in `react/e2e/`.
3. Stops the server when done.

No wallet extension is required — Freighter and Albedo are mocked at the
browser boundary inside the demo app.