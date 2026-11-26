// SPDX-License-Identifier: MIT
// lint-staged configuration (issue #1525)
//
// TypeScript / JavaScript packages:
//   • Prettier  — format staged files (sdk/.prettierrc for the SDK, defaults elsewhere)
//   • ESLint    — lint staged TS files; run per-package so each package's own config is used
//
// Rust files:
//   • cargo fmt --check  — formatting check on staged Rust files
//   • cargo clippy       — lint entire workspace (runs only when Rust files are staged;
//                          clippy cannot be scoped to individual files)
//
// Note: cargo clippy runs the full workspace check to catch cross-crate regressions.
// It is intentionally kept here (not CI-only) so issues are caught locally first.

const CODE_GLOBS = {
  'sdk/**/*.{ts,tsx,js,mjs,cjs}': true,
  'cli/**/*.{ts,tsx,js,mjs,cjs}': true,
  'react/**/*.{ts,tsx,js,mjs,cjs}': true,
  'indexer/**/*.{ts,tsx,js,mjs,cjs}': true,
};

// Packages that ship their own eslint.config.mjs and eslint binary.
const ESLINT_PACKAGES = ['sdk', 'react'];

function quoteArg(file) {
  return `"${file.replace(/"/g, '\\"')}"`;
}

function prettierWrite(files) {
  const targets = files.filter((file) => !file.split(/[/\\]/).includes('generated'));
  if (targets.length === 0) {
    return [];
  }
  return `prettier --write --ignore-unknown ${targets.map(quoteArg).join(' ')}`;
}

/**
 * Run ESLint for packages that have their own config, scoped to staged files.
 * Falls back gracefully when no matching staged files exist in a given package.
 */
function eslintForPackage(pkg) {
  return (files) => {
    const targets = files.filter(
      (f) => f.includes(`${pkg}/`) && !f.split(/[/\\]/).includes('generated'),
    );
    if (targets.length === 0) return [];
    return `npx --prefix ${pkg} eslint --max-warnings=0 ${targets.map(quoteArg).join(' ')}`;
  };
}

const config = {};

// Prettier for all TS/JS packages.
for (const glob of Object.keys(CODE_GLOBS)) {
  config[glob] = prettierWrite;
}

// ESLint per package (sdk, react).
for (const pkg of ESLINT_PACKAGES) {
  const glob = `${pkg}/**/*.{ts,tsx}`;
  const existing = config[glob];
  config[glob] = existing
    ? (files) => [existing(files), eslintForPackage(pkg)(files)].flat()
    : eslintForPackage(pkg);
}

// Rust: cargo fmt --check + cargo clippy for staged .rs files.
config['**/*.rs'] = () => [
  'cargo fmt --all -- --check',
  'cargo clippy --workspace --all-targets -- -D warnings',
];

export default config;
