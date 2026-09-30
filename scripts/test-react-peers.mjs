#!/usr/bin/env node
/**
 * Consumer smoke test for the packed @bc-forge/react tarball (#1041).
 *
 * Installs the tarball plus an SDK tarball into a throwaway directory with
 * --no-package-lock, so the repository lockfile is never written. A supported
 * React 18 or 19 peer must import, server-render Alert, and expose useBalance.
 * Pass --expect-incompatible to require npm to reject the peer (React 17).
 *
 * Usage:
 *   node scripts/test-react-peers.mjs --react 18.0.0 --packs "$RUNNER_TEMP/packs"
 *   node scripts/test-react-peers.mjs --react 17.0.2 --packs "$RUNNER_TEMP/packs" --expect-incompatible
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
  const opts = {
    react: '',
    packs: '',
    stellar: '16.0.1',
    expectIncompatible: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--react') opts.react = argv[++i];
    else if (arg === '--packs') opts.packs = argv[++i];
    else if (arg === '--stellar') opts.stellar = argv[++i];
    else if (arg === '--expect-incompatible') opts.expectIncompatible = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!opts.react || !opts.packs) {
    throw new Error('--react and --packs are required');
  }
  return opts;
}

function findTarball(dir, prefix) {
  const hits = readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith('.tgz'));
  if (hits.length !== 1) {
    throw new Error(
      `expected one ${prefix}*.tgz in ${dir}, found ${hits.join(', ') || 'none'}`,
    );
  }
  return path.join(dir, hits[0]);
}

function npmInstall(cwd, packages) {
  try {
    const stdout = execFileSync(
      'npm',
      ['install', '--no-package-lock', '--no-fund', '--no-audit', ...packages],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ''}\n${error.stderr ?? ''}`,
    };
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sdkTarball = findTarball(opts.packs, 'bc-forge-sdk-');
  const reactTarball = findTarball(opts.packs, 'bc-forge-react-');
  const consumer = mkdtempSync(path.join(tmpdir(), 'bc-forge-react-peer-'));
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'bc-forge-react-consumer', private: true, version: '0.0.0' }, null, 2),
  );

  const install = npmInstall(consumer, [
    `react@${opts.react}`,
    `react-dom@${opts.react}`,
    `@stellar/stellar-sdk@${opts.stellar}`,
    sdkTarball,
    reactTarball,
  ]);

  try {
    if (opts.expectIncompatible) {
      if (install.code === 0) {
        throw new Error(
          `React ${opts.react} is outside the supported peer range but npm install succeeded`,
        );
      }
      if (!/ERESOLVE|peer dep/i.test(install.output)) {
        throw new Error(
          `expected an incompatible peer to fail with ERESOLVE, got:\n${install.output}`,
        );
      }
      console.log(`incompatible React ${opts.react} was rejected`);
      return;
    }

    if (install.code !== 0) {
      throw new Error(`npm install of the packed tarball failed:\n${install.output}`);
    }

    const major = opts.react.split('.')[0];
    writeFileSync(
      path.join(consumer, 'smoke.cjs'),
      `const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const pkg = require('@bc-forge/react');
const required = ['Alert', 'Badge', 'Dropdown', 'BcForgeProvider', 'useBalance'];
for (const name of required) {
  if (pkg[name] == null) {
    console.error('missing export ' + name);
    process.exit(1);
  }
}
const html = renderToStaticMarkup(React.createElement(pkg.Alert, { title: 'Peer' }, 'ok'));
if (typeof html !== 'string' || (!html.includes('Peer') && !html.includes('ok'))) {
  console.error('server render produced unexpected markup', html);
  process.exit(1);
}
if (String(React.version).split('.')[0] !== ${JSON.stringify(major)}) {
  console.error('expected React major ${major}, found ' + React.version);
  process.exit(1);
}
console.log('smoke ok ' + React.version);
`,
    );
    const smoke = execFileSync('node', ['smoke.cjs'], { cwd: consumer, encoding: 'utf8' });
    console.log(smoke.trim());
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
