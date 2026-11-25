#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Bundle size budget gate for @bc-forge/sdk and @bc-forge/react (#1346).
//
// Builds both packages, bundles each built entry point with esbuild
// (minified, third-party dependencies left external so only first-party code is
// measured), gzips the result and fails with exit code 1 when a budget is
// exceeded.
//
// Usage: node scripts/check_bundle_size.mjs [--skip-build]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const KB = 1024;

/** Gzipped budgets in bytes. */
export const BUDGETS = [
  { name: '@bc-forge/sdk', workspace: 'sdk', entry: 'sdk/dist/esm/index.mjs', maxGzipBytes: 150 * KB },
  { name: '@bc-forge/react', workspace: 'react', entry: 'react/dist/index.mjs', maxGzipBytes: 120 * KB },
];

export function formatKb(bytes) {
  return `${(bytes / KB).toFixed(2)} KB`;
}

/** Pure comparison used by the run and by tests. */
export function evaluate(measurements) {
  return measurements.map((m) => ({ ...m, ok: m.gzipBytes <= m.maxGzipBytes }));
}

export function renderTable(results) {
  const rows = [['Package', 'Minified', 'Gzipped', 'Budget', 'Status']];
  for (const r of results) {
    rows.push([
      r.name,
      formatKb(r.minBytes),
      formatKb(r.gzipBytes),
      formatKb(r.maxGzipBytes),
      r.ok ? 'OK' : `OVER by ${formatKb(r.gzipBytes - r.maxGzipBytes)}`,
    ]);
  }
  const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => row[i].length)));
  return rows.map((row) => row.map((c, i) => c.padEnd(widths[i])).join('  ')).join('\n');
}

async function measure(budget) {
  const entry = join(ROOT, budget.entry);
  if (!existsSync(entry)) {
    throw new Error(`Built entry not found: ${budget.entry} (run the build first)`);
  }
  const require = createRequire(join(ROOT, budget.workspace, 'package.json'));
  const esbuild = require('esbuild');
  const pkg = JSON.parse(readFileSync(join(ROOT, budget.workspace, 'package.json'), 'utf8'));
  const external = [
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ].flatMap((d) => [d, `${d}/*`]);
  const out = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    external,
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].contents;
  return { ...budget, minBytes: code.length, gzipBytes: gzipSync(code, { level: 9 }).length };
}

async function main() {
  if (!process.argv.includes('--skip-build')) {
    for (const b of BUDGETS) {
      console.log(`Building ${b.name}...`);
      execFileSync('npm', ['run', 'build', '--workspace', b.name], { cwd: ROOT, stdio: 'inherit' });
    }
  }
  const results = evaluate(await Promise.all(BUDGETS.map(measure)));
  console.log(`\n${renderTable(results)}\n`);
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    for (const f of failed) {
      console.error(`::error::${f.name} is ${formatKb(f.gzipBytes)} gzipped, over the ${formatKb(f.maxGzipBytes)} budget`);
    }
    process.exit(1);
  }
  console.log('All bundles are within budget.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
