import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  installCommand,
  packageJsonForChangesetPublish,
  reactPrereleasePublishPlan,
  resolveReactDistTag,
} from './react-dist-tag.mjs';

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'react-dist-tag.mjs');

test('stable React tags publish on latest', () => {
  for (const tag of ['react-v1.2.3', 'refs/tags/react-v1.2.3', '@bc-forge/react@1.2.3', 'react@1.2.3', '1.2.3']) {
    const resolved = resolveReactDistTag(tag);
    assert.equal(resolved.version, '1.2.3');
    assert.equal(resolved.distTag, 'latest');
    assert.equal(resolved.prerelease, false);
    assert.deepEqual(reactPrereleasePublishPlan(resolved.distTag), {
      publishNow: false,
      args: null,
      skipChangesets: false,
    });
  }
  assert.equal(installCommand('latest'), 'npm install @bc-forge/react');
});

test('beta and rc tags use a prerelease dist-tag and do not touch latest', () => {
  const beta = resolveReactDistTag('react-v1.2.3-beta.4');
  assert.deepEqual(beta, { version: '1.2.3-beta.4', distTag: 'beta', prerelease: true });
  const rc = resolveReactDistTag('react-v2.0.0-rc.1');
  assert.deepEqual(rc, { version: '2.0.0-rc.1', distTag: 'rc', prerelease: true });

  for (const resolved of [beta, rc]) {
    const plan = reactPrereleasePublishPlan(resolved.distTag);
    assert.equal(plan.publishNow, true);
    assert.equal(plan.skipChangesets, true);
    assert.equal(plan.args.at(-1), resolved.distTag);
    assert.equal(plan.args.includes('latest'), false);
    assert.equal(installCommand(resolved.distTag), `npm install @bc-forge/react@${resolved.distTag}`);
  }

  const hidden = packageJsonForChangesetPublish({ name: '@bc-forge/react', version: '1.2.3-beta.4' }, 'beta');
  assert.equal(hidden.private, true);
  const stable = packageJsonForChangesetPublish({ name: '@bc-forge/react', version: '1.2.3' }, 'latest');
  assert.equal(stable.private, undefined);
});

test('unsupported prerelease identifiers are rejected', () => {
  const rejected = [
    'react-v1.2.3-alpha.1',
    'react-v1.2.3-beta',
    'react-v1.2.3-rc',
    'react-v1.2.3-beta.1.2',
    'react-v1.2.3-next.1',
    'react-v1.2.3-rc.01',
    '1.2.3-canary.0',
    'sdk-v1.2.3',
    'indexer-v1.2.3-rc.1',
    '',
  ];
  for (const tag of rejected) {
    assert.throws(() => resolveReactDistTag(tag), /Unsupported prerelease identifier|Not a React release tag|Malformed React version|No React release tag/);
  }
});

test('the CLI prints the dist-tag and fails closed on an unsupported tag', () => {
  const beta = spawnSync(process.execPath, [scriptPath, 'react-v1.4.0-beta.2'], { encoding: 'utf8' });
  assert.equal(beta.status, 0);
  assert.match(beta.stdout, /dist-tag=beta/);
  assert.match(beta.stdout, /latest=unchanged/);

  const stable = spawnSync(process.execPath, [scriptPath, 'react-v1.4.0'], { encoding: 'utf8' });
  assert.equal(stable.status, 0);
  assert.match(stable.stdout, /dist-tag=latest/);
  assert.match(stable.stdout, /latest=updated/);

  const alpha = spawnSync(process.execPath, [scriptPath, 'react-v1.4.0-alpha.1'], { encoding: 'utf8' });
  assert.equal(alpha.status, 1);
  assert.match(alpha.stderr, /Unsupported prerelease identifier/);
});
