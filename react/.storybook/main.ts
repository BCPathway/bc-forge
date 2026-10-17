// SPDX-License-Identifier: MIT
import type { StorybookConfig } from "@storybook/react-vite";
import {
  sharedAliases,
  storybookSdkAlias,
  type SharedAlias,
} from "../demo/aliases";

/**
 * Aliases shared with the demo app (#1139).
 *
 * `sharedAliases` is imported from `react/demo/aliases.ts` — the *same* module
 * the demo's own `vite.config.ts` reads — so a story and the demo resolve
 * `@bc-forge/react` and `@bc-forge/ui` to identical files. There is exactly one
 * place where that mapping is written down.
 *
 * `storybookSdkAlias` is appended after the shared table so it cannot shadow a
 * library alias: stories must never reach a real chain, so `@bc-forge/sdk` is
 * rewritten to the in-memory stub in `react/stories/sdk.ts`. The demo needs the
 * *real* SDK, which is why this entry lives here rather than in the shared
 * table.
 */
const aliases: readonly SharedAlias[] = [...sharedAliases, storybookSdkAlias];

const config: StorybookConfig = {
  framework: "@storybook/react-vite",

  /** Only `*.stories.tsx` is a story file; `fixtures.tsx` / `sdk.ts` are support modules. */
  stories: ["../stories/*.stories.tsx"],

  /**
   * #1144 — The prototyping toolkit.
   *
   * - `@storybook/addon-a11y` runs axe against every story, which is what turns
   *   "mounts with zero console errors" into a checkable bar.
   * - `@storybook/addon-docs` builds the MDX docs pages.
   * - `@storybook/addon-themes` provides the light/dark toolbar toggle, wired
   *   to `globalTypes.theme` in `preview.tsx`.
   *
   * There is deliberately no `@storybook/addon-viewport` entry: that package was
   * discontinued after the 9.x line, and Storybook 10 ships the viewport globals
   * and the `parameters.viewport` API in core. Installing it fails resolution
   * with `ETARGET`, so the presets declared in `preview.tsx` are honoured by the
   * built-in toolbar instead.
   */
  addons: [
    "@storybook/addon-a11y",
    "@storybook/addon-docs",
    "@storybook/addon-themes",
  ],

  core: { disableTelemetry: true },

  async viteFinal(config) {
    const { mergeConfig } = await import("vite");
    return mergeConfig(config, {
      resolve: { alias: [...aliases] },
      esbuild: {
        // Keep the transform identical to the demo's (see
        // `react/demo/vite.config.ts`).
        target: "es2022",
        legalComments: "none",
      },
      optimizeDeps: {
        // Excluded from pre-bundling so the alias above wins for every module,
        // not just the ones Vite happens to discover first.
        exclude: ["@bc-forge/sdk"],
      },
    });
  },
};
export default config;
