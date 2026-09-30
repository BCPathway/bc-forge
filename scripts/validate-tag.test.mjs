import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { validateTag } = require('./validate-tag.js');

const samples = [
  ['sdk-v1.2.3', 'sdk', '1.2.3', 'release.yml'],
  ['cli-v2.0.0', 'cli', '2.0.0', 'release.yml'],
  ['react-v1.0.0-beta.1', 'react', '1.0.0-beta.1', 'release.yml'],
  ['indexer-v0.5.0', 'indexer', '0.5.0', 'publish-indexer.yml'],
];

test('each component tag selects exactly one component', () => {
  const seen = new Map();
  for (const [tag, component, version, workflow] of samples) {
    const result = validateTag(tag);
    assert.equal(result.valid, true, result.error);
    assert.equal(result.component, component);
    assert.equal(result.version, version);
    assert.equal(result.workflow, workflow);
    assert.equal(seen.has(component), false);
    seen.set(component, workflow);
  }
  assert.equal(seen.size, samples.length);
  assert.equal(validateTag('react-v1.0.0-beta.1').version, '1.0.0-beta.1');
});

test('an unrelated release tag selects no publisher', () => {
  for (const tag of ['v1.0.0', 'release-v1.0.0', 'sdk-1.0.0']) {
    const result = validateTag(tag);
    assert.equal(result.valid, false);
    assert.equal(result.component, null);
  }
});

test('a malformed version is rejected', () => {
  const result = validateTag('sdk-vnot-a-version');
  assert.equal(result.valid, false);
  assert.match(result.error, /not a valid semver/);
});
