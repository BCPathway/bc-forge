import assert from 'node:assert/strict';
import test from 'node:test';
import { assertReactTarballListing } from './validate-react-tarball.mjs';

test('a built React tarball listing passes', () => {
  assert.doesNotThrow(() =>
    assertReactTarballListing([
      'package/package.json',
      'package/dist/index.js',
      'package/dist/index.mjs',
      'package/dist/index.d.ts',
    ]),
  );
});

test('missing dist entries fail', () => {
  assert.throws(
    () => assertReactTarballListing(['package/dist/index.js']),
    /missing package\/dist\/index.mjs/,
  );
});

test('unbuilt TypeScript sources fail', () => {
  assert.throws(
    () =>
      assertReactTarballListing([
        'package/dist/index.js',
        'package/dist/index.mjs',
        'package/dist/index.d.ts',
        'package/src/index.ts',
      ]),
    /unbuilt sources/,
  );
});
