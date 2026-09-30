import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Node's native ESM loader does not resolve extensionless relative imports.
 * `tsc` emits those specifiers from the indexer sources, so `npm start`
 * (`node dist/index.js`) exits before it can listen. Append `.js` to relative
 * specifiers in the compiled output.
 */
const relativeSpecifier = /(from\s+|import\s*\(\s*)(['"])(\.\.?\/[^'"]+?)\2/g;

function rewrite(source) {
  return source.replace(relativeSpecifier, (match, lead, quote, spec) => {
    if (spec.endsWith('.js') || spec.endsWith('.json')) {
      return match;
    }
    return `${lead}${quote}${spec}.js${quote}`;
  });
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!path.endsWith('.js')) {
      continue;
    }
    const source = readFileSync(path, 'utf8');
    const next = rewrite(source);
    if (next !== source) {
      writeFileSync(path, next);
    }
  }
}

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
walk(dist);
