import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { checkReleaseTag } from '../../scripts/check-release-tag.mjs';

const fixturesDir = path.resolve(new URL(import.meta.url).pathname, '..', 'fixtures');

async function writeFixture(name, pkg) {
  const dir = path.join(path.resolve(new URL(import.meta.url).pathname, '..'), 'fixtures');
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await fs.writeFile(p, JSON.stringify(pkg, null, 2), 'utf8');
  return p;
}

async function run() {
  // valid stable tag
  const stablePkg = { name: '@bc-forge/react', version: '1.0.0' };
  const stablePath = await writeFixture('react-stable.json', stablePkg);
  await checkReleaseTag(stablePath, { tag: 'refs/tags/react-v1.0.0' });

  // valid prerelease
  const prePkg = { name: '@bc-forge/react', version: '1.0.0-beta.1' };
  const prePath = await writeFixture('react-pre.json', prePkg);
  await checkReleaseTag(prePath, { tag: 'refs/tags/react-v1.0.0-beta.1' });

  // wrong component
  const wrongPkg = { name: '@bc-forge/react', version: '1.0.0' };
  const wrongPath = await writeFixture('react-wrong.json', wrongPkg);
  let threw = false;
  try {
    await checkReleaseTag(wrongPath, { tag: 'refs/tags/sdk-v1.0.0' });
  } catch (e) {
    threw = true;
    assert.match(String(e || ''), /does not match package component/);
  }
  assert.ok(threw, 'Expected wrong component to throw');

  // mismatched version
  const mmPkg = { name: '@bc-forge/react', version: '1.0.0' };
  const mmPath = await writeFixture('react-mm.json', mmPkg);
  threw = false;
  try {
    await checkReleaseTag(mmPath, { tag: 'refs/tags/react-v1.0.1' });
  } catch (e) {
    threw = true;
    assert.match(String(e || ''), /does not match package.json version/);
  }
  assert.ok(threw, 'Expected mismatched version to throw');

  console.log('All tests passed');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1].endsWith('check-release-tag.test.mjs')) {
  run().catch((err) => { console.error(err); process.exit(1); });
}
