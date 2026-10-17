// SPDX-License-Identifier: MIT
/**
 * Single source of truth for the module aliases used by the Vite demo.
 *
 * #1139 — A Vite `resolve.alias` entry and a TypeScript
 * `compilerOptions.paths` entry are two independent declarations of the same
 * fact: which specifier maps to which file on disk. When they drift apart the
 * bundler happily builds something the editor (and `tsc`) reports as broken,
 * or worse, the editor is happy with an import the bundler cannot resolve.
 * Keeping the mapping here means the demo (`vite.config.ts`) and the Storybook
 * config (`.storybook/main.ts`) generate *identical* alias tables, and the
 * mirrored `paths` block in `react/demo/tsconfig.json` can be kept honest by
 * reading it back out of this file.
 *
 * The table is deliberately declarative (`find` + relative `replacement`), with
 * every path resolved at config-evaluation time against this file's own
 * location, so it works regardless of the process' working directory.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path of the `react/` package root (one level above `demo/`). */
export const reactPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A Vite/rollup-style alias pair. `find` is a bare specifier or a `RegExp`;
 * `replacement` is always stored relative to {@link reactPackageRoot} and
 * resolved to an absolute path here so the emitted config is unambiguous.
 */
export interface SharedAlias {
  /** Specifier (or regexp) to rewrite, e.g. `'@bc-forge/react'`. */
  find: string | RegExp;
  /** Absolute path the specifier resolves to. */
  replacement: string;
}

/**
 * Resolve one `replacement` value declared relative to `react/`.
 *
 * Exported so `react/demo/tsconfig.json` can derive its `paths` entries from
 * exactly the same strings the bundler uses.
 */
export const fromReactRoot = (relativePath: string): string => resolve(reactPackageRoot, relativePath);

/**
 * The aliases shared by the demo app and by Storybook (#1139, #1144).
 *
 * Order matters: `@bc-forge/react` is listed before `@bc-forge/ui` so that an
 * exact-match rewrite wins if either entry is ever loosened to a prefix match.
 * Both entries are exact, non-regex finders, so no ordering hazard exists in
 * practice — the note is there for whoever loosens them next.
 */
export const sharedAliases: readonly SharedAlias[] = [
  {
    // The published barrel, resolved straight from TypeScript source so the demo
    // never needs a `tsup` build step to pick up local changes.
    find: '@bc-forge/react',
    replacement: fromReactRoot('src/index.ts'),
  },
  {
    // The "shared UI components" alias from #1139: lets demo code and stories
    // import a single component in isolation (`@bc-forge/ui/Badge`) without
    // pulling the whole barrel (and therefore the SDK) into the graph.
    find: '@bc-forge/ui',
    replacement: fromReactRoot('src/components'),
  },
];

/**
 * The demo-local file aliases. These exist so the demo keeps building while
 * screens land one-by-one: a not-yet-implemented screen resolves to the local
 * placeholder instead of breaking the bundle.
 */
export const demoAliases: readonly SharedAlias[] = [
  { find: '@demo', replacement: resolve(dirname(fileURLToPath(import.meta.url)), 'src') },
];

/**
 * The Storybook-only aliases. Stories must never reach a real chain, so
 * `@bc-forge/sdk` is rewritten to the in-memory stub in `react/stories/sdk.ts`.
 * This entry is appended by `.storybook/main.ts` *after* the shared table and is
 * therefore intentionally left out of it — the demo needs the real SDK.
 */
export const storybookSdkAlias: SharedAlias = {
  find: /^@bc-forge\/sdk$/,
  replacement: fromReactRoot('stories/sdk.ts'),
};

/**
 * Rollup's `manualChunks` hook for the demo build (#1139).
 *
 * The Soroban/Stellar SDK is the single heaviest dependency in the graph
 * (`@stellar/stellar-sdk` pulls in a bundled WebCrypto stack and a large
 * XDR base). Left to Rollup's default it lands in the entry chunk and is
 * parsed before anything can paint. Splitting it — plus React and the rest of
 * the vendor tree — into long-lived, separately cached chunks keeps the
 * *initial* chunk well under the 200 kB budget in the issue's AC.
 *
 * Chunking rules, in priority order:
 *  1. `@stellar/stellar-sdk` and everything nested inside it  → `soroban`.
 *  2. `react`, `react-dom` and `react/jsx-runtime`            → `react`.
 *  3. Anything else under `node_modules`                     → `vendor`.
 *  4. Everything else (app + library source)                 → `undefined`,
 *     which tells Rollup to leave the module where it is.
 *
 * Returning `undefined` for first-party code is the whole point: Rollup only
 * creates a new chunk when it receives a chunk *name*. Never returning a bare
 * empty string, and never bucketing by file, is what keeps this from
 * degenerating into hundreds of one-file chunks.
 *
 * Module ids may be `undefined` for virtual modules (Rollup's own
 * `\0`-prefixed virtual ids, for example), so the id is narrowed before use.
 */
export function demoManualChunks(id: string | undefined): string | undefined {
  if (!id) return undefined;

  // Normalise Windows separators so the `/node_modules/` test works on win32.
  const normalized = id.replace(/\\/g, '/');
  if (!normalized.includes('/node_modules/')) return undefined;

  // Rule 1 — Soroban transport, XDR encoding and the crypto polyfills.
  if (normalized.includes('/node_modules/@stellar/stellar-sdk/')) return 'soroban';

  // Rule 2 — React must not be duplicated across the split chunks.
  if (
    /\/node_modules\/(react|react-dom|scheduler)\//.test(normalized) ||
    /\/node_modules\/react(-dom)?\/[^/]+$/.test(normalized)
  ) {
    return 'react';
  }

  // Rule 3 — everything else third-party.
  return 'vendor';
}