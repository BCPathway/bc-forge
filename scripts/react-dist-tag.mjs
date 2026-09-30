import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_PRERELEASE_IDS = new Set(['beta', 'rc']);

const VERSION =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Map a React release tag or version to an npm dist-tag.
 *
 * - `react-vX.Y.Z`, `@bc-forge/react@X.Y.Z`, and `X.Y.Z` -> `latest`
 * - `react-vX.Y.Z-beta.N` -> `beta`
 * - `react-vX.Y.Z-rc.N` -> `rc`
 *
 * Any other prerelease identifier is rejected so it cannot be published
 * onto `latest` or an unnamed channel.
 *
 * @param {string} tagOrVersion
 * @returns {{ version: string, distTag: 'latest' | 'beta' | 'rc', prerelease: boolean }}
 */
export function resolveReactDistTag(tagOrVersion) {
  if (!tagOrVersion || typeof tagOrVersion !== 'string' || !tagOrVersion.trim()) {
    throw new Error(
      'No React release tag provided. Expected react-vX.Y.Z, react-vX.Y.Z-beta.N, or react-vX.Y.Z-rc.N.',
    );
  }

  let raw = tagOrVersion.trim();
  if (raw.startsWith('refs/tags/')) raw = raw.slice('refs/tags/'.length);

  let version = raw;
  if (raw.startsWith('react-v')) {
    version = raw.slice('react-v'.length);
  } else if (raw.startsWith('@bc-forge/react@')) {
    version = raw.slice('@bc-forge/react@'.length);
  } else if (raw.startsWith('react@')) {
    version = raw.slice('react@'.length);
  } else if (/^[a-z0-9-]+-v/i.test(raw) || raw.startsWith('@')) {
    throw new Error(
      `Not a React release tag: "${tagOrVersion}". Expected react-vX.Y.Z, react-vX.Y.Z-beta.N, or react-vX.Y.Z-rc.N.`,
    );
  }

  const match = VERSION.exec(version);
  if (!match) {
    throw new Error(
      `Malformed React version "${version}". Expected X.Y.Z, X.Y.Z-beta.N, or X.Y.Z-rc.N.`,
    );
  }

  const prerelease = match[4];
  if (!prerelease) {
    return { version, distTag: 'latest', prerelease: false };
  }

  const parts = prerelease.split('.');
  const identifier = parts[0];
  const sequence = parts[1];
  const supportedShape =
    parts.length === 2 &&
    SUPPORTED_PRERELEASE_IDS.has(identifier) &&
    /^(0|[1-9]\d*)$/.test(sequence);

  if (!supportedShape) {
    throw new Error(
      `Unsupported prerelease identifier "${prerelease}" in "${version}". Expected beta.N or rc.N.`,
    );
  }

  return { version, distTag: identifier, prerelease: true };
}

/**
 * Changesets publishes with the `latest` dist-tag. A React prerelease is
 * published first under `beta` or `rc`, then marked private so the following
 * Changesets publish skips it and does not move `latest`.
 *
 * @param {'latest' | 'beta' | 'rc'} distTag
 * @returns {{ publishNow: boolean, args: string[] | null, skipChangesets: boolean }}
 */
export function reactPrereleasePublishPlan(distTag) {
  if (distTag === 'latest') {
    return { publishNow: false, args: null, skipChangesets: false };
  }
  if (distTag !== 'beta' && distTag !== 'rc') {
    throw new Error(`Refusing to publish @bc-forge/react with dist-tag "${distTag}".`);
  }
  return {
    publishNow: true,
    skipChangesets: true,
    args: [
      'publish',
      '--workspace',
      '@bc-forge/react',
      '--access',
      'public',
      '--tag',
      distTag,
    ],
  };
}

/**
 * @param {Record<string, unknown>} packageJson
 * @param {'latest' | 'beta' | 'rc'} distTag
 */
export function packageJsonForChangesetPublish(packageJson, distTag) {
  const plan = reactPrereleasePublishPlan(distTag);
  if (!plan.skipChangesets) return packageJson;
  return { ...packageJson, private: true };
}

export function installCommand(distTag) {
  if (distTag === 'latest') return 'npm install @bc-forge/react';
  return `npm install @bc-forge/react@${distTag}`;
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

function readReactVersion(root) {
  const packageJsonPath = path.join(root, 'react', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  if (!packageJson.version) {
    throw new Error('react/package.json is missing a version.');
  }
  return packageJson.version;
}

function resolveRelease(root) {
  const version = readReactVersion(root);
  const fromVersion = resolveReactDistTag(version);
  const refName = process.env.GITHUB_REF_NAME || '';
  if (refName.startsWith('react-v')) {
    const fromTag = resolveReactDistTag(refName);
    if (fromTag.version !== fromVersion.version) {
      throw new Error(
        `Tag ${refName} (${fromTag.version}) does not match react/package.json version ${fromVersion.version}.`,
      );
    }
    if (fromTag.distTag !== fromVersion.distTag) {
      throw new Error(
        `Tag ${refName} maps to dist-tag ${fromTag.distTag}, but react/package.json maps to ${fromVersion.distTag}.`,
      );
    }
    return fromTag;
  }
  return fromVersion;
}

function isAlreadyPublished(error) {
  const text = `${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.message ?? ''}`;
  return /EPUBLISHCONFLICT|previously published|cannot publish over the previously published/i.test(
    text,
  );
}

function publishPrerelease(root, resolved) {
  const plan = reactPrereleasePublishPlan(resolved.distTag);
  if (!plan.publishNow || !plan.args) return;

  if (plan.args.includes('latest')) {
    throw new Error('Refusing to publish a React prerelease on the latest dist-tag.');
  }

  console.log(
    `Publishing @bc-forge/react@${resolved.version} on dist-tag ${resolved.distTag} (not latest).`,
  );
  try {
    const output = execFileSync('npm', plan.args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (output) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
  } catch (error) {
    if (error.stdout) process.stdout.write(String(error.stdout));
    if (error.stderr) process.stderr.write(String(error.stderr));
    if (!isAlreadyPublished(error)) throw error;
    console.log(
      `@bc-forge/react@${resolved.version} is already on npm. Leaving the latest dist-tag unchanged.`,
    );
  }

  const packageJsonPath = path.join(root, 'react', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const hidden = packageJsonForChangesetPublish(packageJson, resolved.distTag);
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(hidden, null, 2)}\n`);
  console.log(
    'Marked @bc-forge/react private for this job so Changesets will not publish it as latest.',
  );
}

function printResolved(resolved) {
  console.log(`version=${resolved.version}`);
  console.log(`dist-tag=${resolved.distTag}`);
  console.log(`install=${installCommand(resolved.distTag)}`);
  if (resolved.prerelease) {
    console.log('latest=unchanged');
  } else {
    console.log('latest=updated');
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isDirectRun) {
  try {
    const publish = process.argv.includes('--publish-react');
    const positional = process.argv.slice(2).filter((arg) => arg !== '--publish-react');
    const root = repoRoot();
    const resolved = positional.length > 0 ? resolveReactDistTag(positional[0]) : resolveRelease(root);
    printResolved(resolved);
    if (publish) {
      if (positional.length > 0) {
        throw new Error('--publish-react reads react/package.json and does not take a tag argument.');
      }
      publishPrerelease(root, resolved);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
