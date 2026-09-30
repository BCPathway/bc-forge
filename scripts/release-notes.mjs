#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentMap = {
  react: 'react/CHANGELOG.md',
  indexer: 'indexer/CHANGELOG.md',
};

const packageNames = {
  react: '@bc-forge/react',
  indexer: '@bc-forge/indexer',
};

const requiredHeadings = ['Breaking', 'Features', 'Fixes', 'Migrations'];

export function extractReleaseNotes(component, version, rootDir = process.cwd()) {
  const relativePath = componentMap[component];
  if (!relativePath) {
    throw new Error(`Unknown component "${component}". Available components: react, indexer`);
  }

  const changelogPath = path.resolve(rootDir, relativePath);
  if (!existsSync(changelogPath)) {
    throw new Error(`Missing changelog for ${component}: ${changelogPath}`);
  }

  const lines = readFileSync(changelogPath, 'utf8').split(/\r?\n/);
  const header = version
    ? new RegExp(
        `^##\\s+\\[?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]?(?:\\s|$)`,
      )
    : /^##\s+\[?\d+\.\d+\.\d+\]?/;
  const versionLineIndex = lines.findIndex((line) => header.test(line));

  if (versionLineIndex === -1) {
    throw new Error(
      version
        ? `No changelog section for ${component} version ${version}.`
        : 'No published changes recorded yet.',
    );
  }

  const endIndex = lines.findIndex((line, index) => index > versionLineIndex && /^##\s+/.test(line));
  const body = lines.slice(versionLineIndex, endIndex === -1 ? undefined : endIndex).join('\n').trim();

  for (const heading of requiredHeadings) {
    if (!new RegExp(`^###\\s+${heading}\\s*$`, 'm').test(body)) {
      throw new Error(`Changelog section for ${component} is missing "### ${heading}".`);
    }
  }

  return body;
}

function attachPublishedNotes() {
  const raw = process.env.PUBLISHED_PACKAGES || '[]';
  let published;
  try {
    published = JSON.parse(raw || '[]');
  } catch (err) {
    throw new Error(`PUBLISHED_PACKAGES is not valid JSON: ${err.message}`);
  }

  if (!Array.isArray(published) || published.length === 0) {
    console.log('No packages were published; component release notes were not attached.');
    return;
  }

  const selected = published.filter((pkg) =>
    Object.values(packageNames).includes(pkg?.name),
  );

  if (selected.length === 0) {
    console.log('Published packages have no React or indexer release notes to attach.');
    return;
  }

  for (const pkg of selected) {
    const component = Object.entries(packageNames).find(([, name]) => name === pkg.name)?.[0];
    const body = extractReleaseNotes(component, pkg.version);
    const tag = `${pkg.name}@${pkg.version}`;
    console.log(`Attaching ${component} ${pkg.version} notes to GitHub Release ${tag}`);
    try {
      execFileSync('gh', ['release', 'edit', tag, '--notes', body], { stdio: 'inherit' });
    } catch {
      execFileSync(
        'gh',
        ['release', 'create', tag, '--title', tag, '--notes', body],
        { stdio: 'inherit' },
      );
    }
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    if (process.argv[2] === '--attach') {
      attachPublishedNotes();
      process.exit(0);
    }

    const component = process.argv[2];
    const version = process.argv[3];
    if (!component) {
      console.error(
        'Usage: node scripts/release-notes.mjs <react|indexer> [version]\n'
          + '       node scripts/release-notes.mjs --attach',
      );
      process.exit(1);
    }
    console.log(extractReleaseNotes(component, version));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
