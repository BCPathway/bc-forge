// SPDX-License-Identifier: MIT
// Prettier is the formatter already used by @bc-forge/sdk (`npm run format`).
// cli, react, and indexer do not define their own formatter, so staged files
// in those packages are formatted with the same Prettier. Nearest config wins:
// sdk/.prettierrc for the SDK, Prettier defaults elsewhere.

const CODE_GLOBS = {
  'sdk/**/*.{ts,tsx,js,mjs,cjs}': true,
  'cli/**/*.{ts,tsx,js,mjs,cjs}': true,
  'react/**/*.{ts,tsx,js,mjs,cjs}': true,
  'indexer/**/*.{ts,tsx,js,mjs,cjs}': true,
};

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

const config = {};
for (const glob of Object.keys(CODE_GLOBS)) {
  config[glob] = prettierWrite;
}

export default config;
