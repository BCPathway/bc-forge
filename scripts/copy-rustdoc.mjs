// Copies `cargo doc` output into the VitePress `public/` directory so the
// rustdoc HTML is served as static files at /api/contracts/.
//
// Run via `npm run docs:gen:contracts` (after `cargo doc`).

import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const source = resolve(repoRoot, 'target', 'doc');
const destination = resolve(repoRoot, 'docs', 'public', 'api', 'contracts');

await rm(destination, { recursive: true, force: true });
await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });

console.log(`Copied rustdoc from ${source} to ${destination}`);
