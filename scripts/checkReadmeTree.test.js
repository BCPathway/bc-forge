const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkRepository, parseProjectStructure } = require('./checkReadmeTree');

const TREE = `# Sample

## Project Structure

\`\`\`
bc-forge/
├── contracts/
│   ├── admin/
│   └── token/
├── sdk/
├── react/
└── .github/
│   └── ISSUE_TEMPLATE/
\`\`\`
`;

function writeFixture(mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-tree-'));
  fs.writeFileSync(path.join(root, 'README.md'), TREE);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ workspaces: ['sdk', 'react'] }),
  );
  for (const rel of ['contracts/admin', 'contracts/token', 'sdk', 'react', '.github/ISSUE_TEMPLATE']) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  mutate(root);
  return root;
}

test('parseProjectStructure reads contracts and top-level directories', () => {
  const parsed = parseProjectStructure(TREE);
  assert.deepEqual([...parsed.listedContracts].sort(), ['admin', 'token']);
  assert.ok(parsed.listedTopLevel.has('sdk'));
  assert.ok(parsed.listedDirectories.includes('.github/ISSUE_TEMPLATE'));
});

test('a matching tree passes', () => {
  const root = writeFixture(() => {});
  assert.deepEqual(checkRepository(root), []);
});

test('deleting a listed directory fails', () => {
  const root = writeFixture((dir) => {
    fs.rmSync(path.join(dir, 'contracts', 'token'), { recursive: true });
  });
  const errors = checkRepository(root);
  assert.ok(errors.some((error) => error.includes('contracts/token')));
});

test('an undocumented contract fails', () => {
  const root = writeFixture((dir) => {
    fs.mkdirSync(path.join(dir, 'contracts', 'undocumented'));
  });
  const errors = checkRepository(root);
  assert.ok(errors.some((error) => error.includes('contracts/undocumented')));
});

test('an ignored contract name does not fail', () => {
  const root = writeFixture((dir) => {
    fs.mkdirSync(path.join(dir, 'contracts', 'scratch'));
  });
  assert.deepEqual(checkRepository(root, { ignoredContracts: new Set(['scratch']) }), []);
});
