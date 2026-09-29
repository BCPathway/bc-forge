#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function parseTag(ref) {
  if (!ref) return null;
  // ref form: refs/tags/<tag>
  const m = ref.match(/^refs\/tags\/(.+)$/);
  if (!m) return null;
  const tag = m[1];
  // accept optional scope like @bc-forge/react-v1.2.3
  // component may contain letters, digits, - and _
  const rx = /^(?:@[^/]+\/)?(?<component>[^-]+)-v?(?<version>\d+\.\d+\.\d+(?:[-.][0-9A-Za-z-.]+)?)$/;
  const mr = tag.match(rx);
  if (!mr) return null;
  return { tag, component: mr.groups.component, version: mr.groups.version };
}

export async function checkReleaseTag(pkgPath, { tag } = {}) {
  const abs = path.resolve(pkgPath);
  const raw = await fs.readFile(abs, 'utf8');
  const pkg = JSON.parse(raw);
  const pkgName = pkg.name;
  const pkgVersion = pkg.version;

  const envRef = process.env.GITHUB_REF;
  const ref = tag || envRef;
  if (!ref) throw new Error('Missing tag: set GITHUB_REF or pass --tag');

  const parsed = parseTag(ref);
  if (!parsed) throw new Error(`Tag '${ref}' is not a valid component tag (expected '<component>-vX.Y.Z')`);

  // derive component name from package name
  const pkgComponent = pkgName.includes('/') ? pkgName.split('/').pop() : pkgName;

  if (parsed.component !== pkgComponent) {
    throw new Error(`Tag component '${parsed.component}' does not match package component '${pkgComponent}'`);
  }

  if (parsed.version !== pkgVersion) {
    throw new Error(`Tag version '${parsed.version}' does not match package.json version '${pkgVersion}'`);
  }

  // success
  return true;
}

if (process.argv[1] && process.argv[1].endsWith('check-release-tag.mjs')) {
  // CLI
  const args = process.argv.slice(2);
  let pkgPath = 'react/package.json';
  let tagArg = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--pkg' && args[i+1]) { pkgPath = args[++i]; continue; }
    if (a === '--tag' && args[i+1]) { tagArg = args[++i]; continue; }
  }
  checkReleaseTag(pkgPath, { tag: tagArg }).then(() => {
    console.log('Tag matches package version.');
    process.exit(0);
  }).catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
