/**
 * `tsc` emits extensionless relative specifiers. Node's native ESM loader
 * rejects those, and this package stays without `"type": "module"` so the
 * existing CommonJS `dist/index.js` (the `main` entry) is unchanged.
 * Rename the ESM emit to `.mjs` and point each relative specifier at the
 * real file, including directory imports such as `./generated/src`.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distEsm = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'esm');

const relativeSpecifier = /((?:from|import)\s*\(?\s*)(['"])(\.\.?\/[^'"]+)\2/g;

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function resolveSpecifier(fromFile, spec) {
  const ext = path.extname(spec);
  if (ext === '.json' || ext === '.mjs' || ext === '.cjs') {
    return spec;
  }

  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates =
    ext === '.js' ? [base] : ext === '' ? [`${base}.js`, path.join(base, 'index.js')] : [];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    let relative = toPosix(path.relative(path.dirname(fromFile), candidate));
    if (!relative.startsWith('.')) relative = `./${relative}`;
    return relative.replace(/\.js$/, '.mjs');
  }

  throw new Error(`Unresolved relative import "${spec}" in ${fromFile}`);
}

function rewrite(fromFile, source) {
  return source.replace(relativeSpecifier, (_match, lead, quote, spec) => {
    return `${lead}${quote}${resolveSpecifier(fromFile, spec)}${quote}`;
  });
}

function collectJsFiles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      collectJsFiles(fullPath, found);
      continue;
    }
    if (fullPath.endsWith('.js')) found.push(fullPath);
  }
  return found;
}

if (!existsSync(distEsm)) {
  console.error(`ESM output not found: ${distEsm}`);
  process.exit(1);
}

const files = collectJsFiles(distEsm);
if (files.length === 0) {
  console.error(`No ESM JavaScript emitted in ${distEsm}`);
  process.exit(1);
}

const planned = files.map((file) => ({
  file,
  next: rewrite(file, readFileSync(file, 'utf8')),
}));

for (const { file, next } of planned) {
  writeFileSync(file.replace(/\.js$/, '.mjs'), next);
  rmSync(file);
}

console.log(`Prepared ${planned.length} ESM files in ${distEsm}`);
