import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KNOWN_PACKAGES = {
  sdk: 'sdk/package.json',
  cli: 'cli/package.json',
  react: 'react/package.json',
  indexer: 'indexer/package.json',
};

const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/**
 * Parse a release tag into a component and version.
 *
 * Accepted forms:
 * - `sdk@1.2.3`
 * - `sdk-v1.2.3`
 * - `@bc-forge/sdk@1.2.3` (Changesets tag)
 * - `refs/tags/` prefixed variants of the above
 *
 * @param {string} tagInput
 * @returns {{ component: string, version: string, tag: string }}
 */
export function parseReleaseTag(tagInput) {
  if (!tagInput || typeof tagInput !== 'string' || !tagInput.trim()) {
    throw new Error('No tag provided. Expected format: <component>@<version> (e.g. sdk@1.2.3)');
  }

  let tag = tagInput.trim();
  if (tag.startsWith('refs/tags/')) {
    tag = tag.slice('refs/tags/'.length);
  }

  const scoped = tag.match(/^@bc-forge\/([a-z0-9-]+)@(.+)$/);
  const prefixed = tag.match(/^([a-z0-9-]+)-v(.+)$/);
  const short = tag.match(/^([a-z0-9-]+)@([^@]+)$/);
  const match = scoped || prefixed || short;

  if (!match) {
    throw new Error(
      `Malformed tag format: "${tagInput}". Expected <component>@<version>, <component>-v<version>, or @bc-forge/<component>@<version>.`,
    );
  }

  const component = match[1];
  const version = match[2];

  if (!component || !version) {
    throw new Error(
      `Malformed tag format: "${tagInput}". Expected format: <component>@<version> (e.g. sdk@1.2.3, cli@0.5.0, react@2.0.1)`,
    );
  }

  if (!KNOWN_PACKAGES[component]) {
    throw new Error(`Unknown component "${component}"`);
  }

  if (!SEMVER.test(version)) {
    throw new Error(
      `Malformed tag format: "${tagInput}". Version "${version}" is not valid semver.`,
    );
  }

  return { component, version, tag };
}

/**
 * Validates a Git release tag against package.json manifests and registry state.
 *
 * @param {string} tagInput - Raw Git tag string (e.g. "sdk@0.1.0" or "refs/tags/cli-v0.1.0")
 * @param {object} [options]
 * @param {string} [options.rootDir] - Absolute path to repository root
 * @param {function} [options.checkRegistry] - Custom function to check registry publication
 * @returns {{ success: boolean, component: string, version: string, packageName: string, message: string }}
 */
export function validateVersionTag(tagInput, options = {}) {
  const currentFilePath = fileURLToPath(import.meta.url);
  const rootDir = options.rootDir || path.resolve(path.dirname(currentFilePath), '..');
  const { component, version, tag } = parseReleaseTag(tagInput);

  const packageJsonRelPath = KNOWN_PACKAGES[component];
  const packageJsonPath = path.resolve(rootDir, packageJsonRelPath);

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Package manifest not found at ${packageJsonPath}`);
  }

  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse package manifest at ${packageJsonPath}: ${err.message}`);
  }

  const manifestVersion = packageJson.version;
  const packageName = packageJson.name;

  if (!manifestVersion) {
    throw new Error(`Missing "version" field in package manifest at ${packageJsonRelPath}`);
  }

  if (version !== manifestVersion) {
    throw new Error(
      `Tag version "${version}" does not match package.json version "${manifestVersion}" for component "${component}" (${packageJsonRelPath})`,
    );
  }

  const checkRegistry = options.checkRegistry || defaultCheckRegistry;
  const isPublished = checkRegistry(packageName, version);

  if (isPublished) {
    throw new Error(
      `Version "${version}" of package "${packageName}" is already published on the registry.`,
    );
  }

  return {
    success: true,
    component,
    version,
    packageName,
    message: `Tag "${tag}" is valid for package "${packageName}" at version "${version}".`,
  };
}

/**
 * Decide what a release rerun should do with one package (#1036).
 *
 * - Not on npm: publish.
 * - Exact version is already published and the registry version plus tarball
 *   match the intended version: no-op.
 * - An existing registry record does not match the intended version: fail.
 *
 * @param {{ published: boolean, remoteVersion?: string | null, intendedVersion: string, hasArtifact?: boolean }} input
 * @returns {'publish' | 'noop' | 'mismatch'}
 */
export function classifyRegistryRelease({
  published,
  remoteVersion,
  intendedVersion,
  hasArtifact,
  artifactMatches = true,
}) {
  if (!published) return 'publish';
  if (remoteVersion === intendedVersion && hasArtifact && artifactMatches) return 'noop';
  return 'mismatch';
}

/**
 * Validate every workspace package Changesets is about to publish.
 *
 * A direct tag check (`validateVersionTag`) still rejects an already published
 * version. This release path does not: a matching republish is a no-op, and a
 * registry record that does not match the intended version fails.
 *
 * @param {object} [options]
 * @param {string} [options.rootDir]
 * @param {string[]} [options.components]
 * @param {function} [options.inspectRegistry] - ({ packageName, version }) => { published, remoteVersion, hasArtifact }
 * @returns {Array<{ success: boolean, noop?: boolean, component: string, version: string, packageName: string, message: string }>}
 */
export function validateBeforeChangesetPublish(options = {}) {
  const currentFilePath = fileURLToPath(import.meta.url);
  const rootDir = options.rootDir || path.resolve(path.dirname(currentFilePath), '..');
  const inspectRegistry = options.inspectRegistry || defaultInspectRegistry;
  const components = options.components || Object.keys(KNOWN_PACKAGES);
  const results = [];

  for (const component of components) {
    if (!KNOWN_PACKAGES[component]) {
      throw new Error(`Unknown component "${component}"`);
    }
    const packageJsonPath = path.resolve(rootDir, KNOWN_PACKAGES[component]);
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const intendedVersion = packageJson.version;
    const packageName = packageJson.name;
    const remote = inspectRegistry({ packageName, version: intendedVersion });
    const action = classifyRegistryRelease({
      published: Boolean(remote && remote.published),
      remoteVersion: remote ? remote.remoteVersion : null,
      intendedVersion,
      hasArtifact: Boolean(remote && remote.hasArtifact),
      artifactMatches: !remote || remote.artifactMatches !== false,
    });

    if (action === 'noop') {
      results.push({
        success: true,
        noop: true,
        component,
        version: intendedVersion,
        packageName,
        message: `${packageName}@${intendedVersion} is already published and matches the intended version. Rerun is a no-op.`,
      });
      continue;
    }

    if (action === 'mismatch') {
      const seen = remote && remote.remoteVersion ? remote.remoteVersion : 'none';
      throw new Error(
        `${packageName}@${intendedVersion} does not match the existing npm artifact (registry version "${seen}").`,
      );
    }

    results.push(
      validateVersionTag(`${component}@${intendedVersion}`, {
        rootDir,
        checkRegistry: () => false,
      }),
    );
  }

  return results;
}

function defaultCheckRegistry(packageName, version) {
  try {
    const output = execSync(`npm view ${packageName}@${version} version`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    }).trim();

    if (output && output.includes(version)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function defaultInspectRegistry({ packageName, version }) {
  try {
    const stdout = execSync(`npm view ${packageName}@${version} --json`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20000,
    });
    const parsed = JSON.parse(stdout);
    const doc = Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
    if (!doc || doc.error || !doc.version) {
      return { published: false, remoteVersion: null, hasArtifact: false };
    }
    return {
      published: true,
      remoteVersion: doc.version,
      hasArtifact: Boolean(doc.dist && doc.dist.tarball),
    };
  } catch (error) {
    const text = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (text.includes('E404') || text.includes('404')) {
      return { published: false, remoteVersion: null, hasArtifact: false };
    }
    throw error;
  }
}

function parseCli(argv) {
  let beforePublish = false;
  const components = [];
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--before-changeset-publish') {
      beforePublish = true;
    } else if (arg === '--component') {
      const component = argv[i + 1];
      if (!component) throw new Error('Missing component after --component');
      components.push(component);
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { beforePublish, components, positional };
}

const currentScriptPath = path.resolve(fileURLToPath(import.meta.url));
const entryScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : null;

if (entryScriptPath === currentScriptPath) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.beforePublish) {
      const results = validateBeforeChangesetPublish({
        components: cli.components.length > 0 ? cli.components : undefined,
      });
      if (results.length === 0) {
        console.log('No unpublished package versions to validate.');
      } else {
        for (const result of results) {
          console.log(`✓ ${result.message}`);
        }
      }
      process.exit(0);
    }

    const rawTag = cli.positional[0] || process.env.GITHUB_REF || process.env.GIT_TAG;
    const result = validateVersionTag(rawTag);
    console.log(`✓ ${result.message}`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Version tag validation failed: ${err.message}`);
    process.exit(1);
  }
}
