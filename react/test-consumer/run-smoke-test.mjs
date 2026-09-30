import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reactDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(reactDir, '..');
const sdkDir = path.resolve(rootDir, 'sdk');
const fixtureDir = path.resolve(reactDir, 'test-consumer');
const requiredPeers = ['react', 'react-dom', '@stellar/stellar-sdk'];

function run(command, cwd) {
  return execSync(command, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
}

function runInherit(command, cwd) {
  execSync(command, { cwd, stdio: 'inherit' });
}

function expectBuildFailure(cwd, label) {
  try {
    run('npm run build', cwd);
  } catch (err) {
    console.log(`Negative test passed: ${label} failed the production build.`);
    return;
  }
  throw new Error(`Expected the production build to fail for ${label}.`);
}

console.log('Building SDK and React packages...');
runInherit('npm run build', sdkDir);
runInherit('npm run build', reactDir);

console.log('Packing SDK and React tarballs...');
const sdkPackResult = JSON.parse(run('npm pack --json --ignore-scripts', sdkDir));
const sdkTarball = path.join(sdkDir, sdkPackResult[0].filename);
const reactPackResult = JSON.parse(run('npm pack --json --ignore-scripts', reactDir));
const reactTarball = path.join(reactDir, reactPackResult[0].filename);

const workRoot = path.join(os.tmpdir(), `bc-forge-react-consumer-${Date.now()}`);
mkdirSync(workRoot, { recursive: true });

try {
  const packedManifest = JSON.parse(readFileSync(path.join(reactDir, 'package.json'), 'utf8'));
  const declaredPeers = packedManifest.peerDependencies ?? {};
  for (const name of requiredPeers) {
    if (!declaredPeers[name]) {
      throw new Error(`@bc-forge/react package.json is missing peer dependency "${name}".`);
    }
  }

  const consumerDir = path.join(workRoot, 'consumer');
  cpSync(fixtureDir, consumerDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.endsWith(`${path.sep}dist`),
  });

  console.log('Installing packed tarball and supported peers...');
  run(`npm install --no-save "${sdkTarball}" "${reactTarball}"`, consumerDir);
  const installedFrom = JSON.parse(
    readFileSync(path.join(consumerDir, 'node_modules', '@bc-forge', 'react', 'package.json'), 'utf8'),
  );
  if (!installedFrom.peerDependencies?.react) {
    throw new Error('Packed tarball is missing the react peer dependency.');
  }
  console.log('Packed tarball declares the required peer dependencies.');

  console.log('Running production build against the packed tarball...');
  runInherit('npm run build', consumerDir);
  const bundlePath = path.join(consumerDir, 'dist', 'bundle.js');
  if (!existsSync(bundlePath)) {
    throw new Error('Production build failed to generate dist/bundle.js');
  }
  console.log('Positive test passed: production build rendered a component and imported a hook.');

  const missingExportDir = path.join(workRoot, 'missing-export');
  cpSync(consumerDir, missingExportDir, { recursive: true });
  rmSync(path.join(missingExportDir, 'dist'), { recursive: true, force: true });
  writeFileSync(
    path.join(missingExportDir, 'src', 'index.tsx'),
    "import { NonExistentComponent } from '@bc-forge/react';\nconsole.log(NonExistentComponent);\n",
    'utf8',
  );
  console.log('Testing negative case: missing export...');
  expectBuildFailure(missingExportDir, 'a missing export');

  const missingPeerDir = path.join(workRoot, 'missing-peer');
  cpSync(fixtureDir, missingPeerDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) && !source.endsWith(`${path.sep}dist`),
  });
  const peerManifest = JSON.parse(readFileSync(path.join(missingPeerDir, 'package.json'), 'utf8'));
  delete peerManifest.dependencies.react;
  delete peerManifest.dependencies['react-dom'];
  delete peerManifest.devDependencies['@types/react'];
  delete peerManifest.devDependencies['@types/react-dom'];
  writeFileSync(path.join(missingPeerDir, 'package.json'), `${JSON.stringify(peerManifest, null, 2)}\n`);
  console.log('Testing negative case: missing peer dependency...');
  run(`npm install --legacy-peer-deps --no-save "${sdkTarball}" "${reactTarball}"`, missingPeerDir);
  expectBuildFailure(missingPeerDir, 'a missing peer dependency');

  console.log('All React package consumer smoke tests passed successfully!');
} finally {
  rmSync(sdkTarball, { force: true });
  rmSync(reactTarball, { force: true });
  rmSync(workRoot, { recursive: true, force: true });
}
