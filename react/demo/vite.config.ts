// SPDX-License-Identifier: MIT
/**
 * Production-grade Vite configuration for the bc-forge React demo (#1139).
 *
 * The three-way consistency requirement
 * ------------------------------------
 * A module specifier such as `@bc-forge/ui` has to be understood in exactly
 * three places, and all three must agree or the project "works on my machine":
 *
 *   1. **the bundler** — `resolve.alias` below (dev server *and* `vite build`);
 *   2. **the editor / `tsc`** — `compilerOptions.paths`, mirrored in
 *      `react/demo/tsconfig.json` (which extends `tsconfig.demo.json`);
 *   3. **anything else that bundles the demo** — Storybook reads the *same*
 *      alias table out of `./aliases` via `react/.storybook/main.ts` (#1144).
 *
 * `./aliases` is therefore the single source of truth; anything added there must
 * also be added to the mirrored `paths` block in `tsconfig.demo.json`.
 *
 * Bundle budget
 * -------------
 * The AC for this issue is a sub-200 kB *initial* chunk. `manualChunks` below
 * peels `@stellar/stellar-sdk` (the Soroban/RPC dependency, by far the heaviest
 * thing in the graph) plus React and the rest of `node_modules` into
 * long-lived, separately cached chunks. Those chunks are still fetched on a
 * cold load, but they are content-hash stable across deploys, so they are
 * cached independently of the app code and never invalidate the entry chunk.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { demoAliases, demoManualChunks, sharedAliases } from './aliases';

const DEV_SERVER_PORT = 5173;
const PREVIEW_SERVER_PORT = 4173;
const MANIFEST_FILE = 'dist/.vite/manifest.json';

/** The sub-200 kB initial-chunk budget from the issue's acceptance criteria. */
const INITIAL_CHUNK_BUDGET_KB = 200;

/** The subset of Vite's manifest shape this plugin reads. */
interface ManifestChunk {
  file: string;
  isEntry?: boolean;
  imports?: string[];
}

/**
 * Reads back the manifest the build just emitted and prints the uncompressed
 * size of every *initial* chunk (the entry point plus whatever the entry
 * imports statically).
 *
 * The AC for #1139 is a sub-200 kB initial chunk. A full bundle analyzer is a
 * heavyweight dependency to add for a demo, so this ~40-line plugin answers the
 * same question — "is the entry bundle still small?" — on every build, with no
 * extra install. `react/demo/README.md` documents how to run a full visualizer
 * when you want the whole graph.
 *
 * Deliberately written without Rollup's plugin `this` context: its type differs
 * between Rollup hook versions (`this: void` on `closeBundle` in some), and
 * `console` is what this report needs anyway.
 */
function bundleBudgetPlugin(): Plugin {
  return {
    name: 'bc-forge:bundle-budget',
    apply: 'build',
    closeBundle() {
      let manifest: Record<string, ManifestChunk>;
      try {
        manifest = JSON.parse(
          readFileSync(resolve(MANIFEST_FILE), 'utf8'),
        ) as Record<string, ManifestChunk>;
      } catch {
        console.warn(
          `[bc-forge] Could not read ${MANIFEST_FILE}; skipping the bundle budget report.`,
        );
        return;
      }

      // A statically imported chunk is downloaded with the entry point; a
      // dynamically imported one is not, so it is excluded from the budget.
      const initial = new Set<string>();
      const visit = (key: string): void => {
        if (initial.has(key)) return;
        initial.add(key);
        for (const imported of manifest[key]?.imports ?? []) visit(imported);
      };
      for (const [key, chunk] of Object.entries(manifest)) {
        if (chunk.isEntry) visit(key);
      }

      const lines: string[] = [];
      let total = 0;
      for (const key of initial) {
        const chunk = manifest[key];
        if (!chunk) continue;
        const bytes = Buffer.byteLength(
          readFileSync(resolve('dist', chunk.file), 'utf8'),
        );
        total += bytes;
        lines.push(`  ${chunk.file}  ${(bytes / 1024).toFixed(1)} kB`);
      }

      const kb = total / 1024;
      const verdict = kb <= INITIAL_CHUNK_BUDGET_KB ? 'within budget' : 'OVER BUDGET';
      console.info(
        `[bc-forge] Initial chunk (#1139): ${kb.toFixed(1)} kB uncompressed, ` +
          `${verdict} (budget ${INITIAL_CHUNK_BUDGET_KB} kB)\n${lines.sort().join('\n')}`,
      );
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: [
    react({
      // The automatic JSX runtime is the default, but pinning the plugin's
      // `jsxRuntime` keeps the transform identical between the dev server and
      // the production build.
      jsxRuntime: 'automatic',
    }),
    bundleBudgetPlugin(),
  ],

  resolve: {
    /**
     * `{ find, replacement }` pairs, exactly as Vite documents them.
     *
     * `sharedAliases` covers the library entry points (`@bc-forge/react`, the
     * barrel, and `@bc-forge/ui`, the shared component directory). They point
     * at TypeScript *source*, so the demo hot-reloads library edits without a
     * `tsup` build — that is what keeps the dev server under the 500 ms budget
     * in the AC, since nothing has to be compiled or watched twice.
     *
     * `demoAliases` is for demo-local shims (placeholders for screens that have
     * not landed yet). Adding `@demo/*` there is safe and exact.
     */
    alias: [...sharedAliases, ...demoAliases],

    /**
     * `dedupe` forces a single copy of each package to be used. Pinning
     * `react`/`react-dom` to the hoisted copy is what stops the classic "two
     * Reacts, broken hooks" failure once the SDK and the demo both pull React
     * in.
     */
    dedupe: ['react', 'react-dom'],
  },

  /**
   * Dev server settings. `open: false` keeps `npm run dev` non-interactive so
   * the Playwright `webServer` in `react/playwright.config.ts` can boot it
   * unattended; the port stays 5173 because that config (and
   * `react/e2e/*`) hard-codes `http://localhost:5173`.
   */
  server: {
    port: DEV_SERVER_PORT,
    // Fail loudly instead of silently moving to 5174 — a moved port would make
    // every e2e spec time out against a server that is not there.
    strictPort: true,
    host: '127.0.0.1',
    open: false,
    // HMR needs its own headers kept fresh; never cache a dev asset.
    headers: { 'Cache-Control': 'no-store' },
  },

  /**
   * `vite preview` serves the production build. It is deliberately *not* on
   * 5173 so a running dev server never shadows a preview server.
   */
  preview: {
    port: PREVIEW_SERVER_PORT,
    strictPort: true,
    host: '127.0.0.1',
    open: false,
  },

  /**
   * esbuild is what transpiles this project's TypeScript and what minifies the
   * output. Keeping the target explicit (rather than Vite's default of
   * `modules`) keeps the emitted syntax identical between the dev server and
   * the production build.
   */
  esbuild: {
    target: 'es2022',
    legalComments: 'none',
  },

  css: {
    // Dev-only source maps for the stylesheet. Tailwind's generated CSS is
    // large enough that stepping through it without maps is painful.
    devSourcemap: true,
  },

  build: {
    // ES2022 matches the esbuild target above; browsers that need more
    // downlevelling can be added here without touching anything else.
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: command === 'build' ? 'hidden' : false,
    // `hidden` still emits full source maps — they just do not get a
    // `//# sourceMappingURL` comment appended, so they are only downloaded by
    // dev tools (e.g. an error reporter) and never by an end user.
    minify: 'esbuild',
    cssMinify: true,
    // Required for `manualChunks` to see the whole module graph, and required by
    // `bundleBudgetPlugin` above.
    manifest: true,
    reportCompressedSize: false,
    /**
     * The initial chunk is budgeted at 200 kB by the issue's AC. 250 kB of
     * uncompressed code is the warning threshold: loud enough to notice a
     * regression that reintroduces the SDK into the entry chunk, quiet enough
     * that the intentional `soroban` / `vendor` chunks (which are large *on
     * purpose*) do not cry wolf on every build.
     */
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        /**
         * Split the heavy Soroban/RPC dependencies out of the initial chunk.
         *
         * The function itself (and the reasoning behind each bucket) lives in
         * `./aliases` so it can be reasoned about independently of this config
         * file. `onlyExplicitManualChunks: true` is the important flag here:
         * without it Rollup merges *every* module reachable from the entry
         * point into the `manualChunks` result, which silently destroys the
         * code splitting we are asking for.
         */
        manualChunks: demoManualChunks,
        onlyExplicitManualChunks: true,
        // Readable filenames in a human-facing demo build; hashed filenames
        // still separate app code from the stable vendor chunks.
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
}));