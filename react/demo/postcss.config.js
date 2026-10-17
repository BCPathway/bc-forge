// SPDX-License-Identifier: MIT
/**
 * PostCSS configuration for the bc-forge demo (#1140).
 *
 * Vite picks this file up automatically for both the dev server and
 * `vite build`, so the stylesheet is processed identically in both — which is
 * what makes the "Tailwind utilities are compiled into demo styles" AC
 * verifiable in dev *and* in the production bundle.
 *
 * Only the two plugins the demo needs are registered:
 *
 *   1. `tailwindcss` — expands the `@tailwind` directives in `src/index.css`
 *      into real CSS, reading `./tailwind.config.js` for the token set;
 *   2. `autoprefixer` — adds the vendor prefixes the 500 ms dev-server budget
 *      and the supported browser matrix need.
 *
 * No nesting plugin: the stylesheet deliberately sticks to plain CSS plus the
 * `@apply` directives Tailwind itself understands, so the build stays a
 * two-plugin pipeline that is easy to reason about.
 *
 * `postcss-load-config` is not a dependency — Vite 6 reads this file directly,
 * so no extra package is required.
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};