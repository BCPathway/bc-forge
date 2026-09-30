import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED = ['package/dist/index.js', 'package/dist/index.mjs', 'package/dist/index.d.ts'];

export function assertReactTarballListing(listing) {
  const files = listing.map((entry) => entry.trim()).filter(Boolean);
  const missing = REQUIRED.filter((entry) => !files.includes(entry));
  if (missing.length > 0) {
    throw new Error(`React tarball is missing ${missing.join(', ')}`);
  }
  const sources = files.filter((entry) => /^package\/src\/.*\.(ts|tsx)$/.test(entry));
  if (sources.length > 0) {
    throw new Error(`React tarball contains unbuilt sources: ${sources.join(', ')}`);
  }
}

function packReact(root) {
  const dest = mkdtempSync(path.join(tmpdir(), 'bc-forge-react-pack-'));
  try {
    execFileSync(
      'npm',
      ['pack', '--workspace', '@bc-forge/react', '--ignore-scripts', '--pack-destination', dest],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
    );
    const tarball = readdirSync(dest).find((name) => name.endsWith('.tgz'));
    if (!tarball) throw new Error('React pack did not produce a tarball');
    const listing = execFileSync('tar', ['-tzf', path.join(dest, tarball)], { encoding: 'utf8' });
    assertReactTarballListing(listing.split(/\r?\n/));
    return tarball;
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const tarball = packReact(root);
    console.log(`React tarball ${tarball} is valid`);
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
