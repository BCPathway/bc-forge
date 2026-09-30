#!/usr/bin/env node
/**
 * Check the README "## Project Structure" block against the repository (#1027).
 *
 * Fails when a directory listed in that block is missing, when a first-level
 * contract crate is not listed, or when a workspace package directory is not
 * listed.
 *
 * Ignored while scanning for undocumented contracts and packages (generated
 * or internal directory names). These names are not required to appear in
 * the Project Structure block:
 *   node_modules, dist, target, coverage, .git
 *
 * There are no extra ignored contract crates or workspace packages. Add a
 * name to IGNORED_CONTRACTS or IGNORED_PACKAGES only when a directory should
 * exist without being documented, and mention it in this comment.
 */
const fs = require('fs');
const path = require('path');

const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', 'target', 'coverage', '.git']);
const IGNORED_CONTRACTS = new Set();
const IGNORED_PACKAGES = new Set();

function parseProjectStructure(readme) {
  const heading = readme.indexOf('## Project Structure');
  if (heading < 0) {
    throw new Error('README.md has no "## Project Structure" section');
  }
  const fenceStart = readme.indexOf('```', heading);
  const fenceEnd = readme.indexOf('```', fenceStart + 3);
  if (fenceStart < 0 || fenceEnd < 0) {
    throw new Error('Project Structure section has no fenced tree');
  }
  const block = readme.slice(fenceStart + 3, fenceEnd);
  const listedDirectories = [];
  const listedContracts = new Set();
  const listedTopLevel = new Set();
  const stack = [];

  for (const line of block.split(/\r?\n/)) {
    const marker = line.indexOf('── ');
    if (marker < 0) continue;
    const rawName = line.slice(marker + 3).split(/\s+#/)[0].trim();
    const prefix = line.slice(0, marker);
    const depth = (prefix.match(/[│├└]/g) || []).length - 1;
    if (depth < 0) continue;
    const isDirectory = rawName.endsWith('/');
    const name = rawName.replace(/\/$/, '');
    if (!name || name.includes(' ')) continue;
    stack.length = depth;
    stack[depth] = name;
    if (!isDirectory) continue;
    const rel = stack.slice(0, depth + 1).join('/');
    listedDirectories.push(rel);
    if (depth === 0) listedTopLevel.add(name);
    if (depth === 1 && stack[0] === 'contracts') listedContracts.add(name);
  }

  return { listedDirectories, listedContracts, listedTopLevel };
}

function readWorkspacePackages(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return (manifest.workspaces || []).map((entry) => entry.split('/')[0]);
}

function listChildDirs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !IGNORED_DIR_NAMES.has(entry.name) && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}

function checkRepository(root, options = {}) {
  const ignoredContracts = options.ignoredContracts || IGNORED_CONTRACTS;
  const ignoredPackages = options.ignoredPackages || IGNORED_PACKAGES;
  const readmePath = path.join(root, 'README.md');
  if (!fs.existsSync(readmePath)) {
    throw new Error(`README.md not found at ${readmePath}`);
  }
  const parsed = parseProjectStructure(fs.readFileSync(readmePath, 'utf8'));
  const errors = [];

  for (const rel of parsed.listedDirectories) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      errors.push(`listed directory is missing: ${rel}`);
    }
  }

  for (const name of listChildDirs(path.join(root, 'contracts'))) {
    if (ignoredContracts.has(name)) continue;
    if (!parsed.listedContracts.has(name)) {
      errors.push(`undocumented contract directory: contracts/${name}`);
    }
  }

  for (const name of readWorkspacePackages(root)) {
    if (ignoredPackages.has(name) || IGNORED_DIR_NAMES.has(name)) continue;
    if (!parsed.listedTopLevel.has(name)) {
      errors.push(`undocumented package directory: ${name}`);
    }
  }

  return errors;
}

function main() {
  const root = path.resolve(__dirname, '..');
  const errors = checkRepository(root);
  if (errors.length > 0) {
    console.error('README project structure check failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log('README project structure matches the repository.');
}

module.exports = {
  IGNORED_CONTRACTS,
  IGNORED_DIR_NAMES,
  IGNORED_PACKAGES,
  checkRepository,
  parseProjectStructure,
};

if (require.main === module) main();
