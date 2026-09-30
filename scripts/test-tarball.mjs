import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dirs = {
  "@bc-forge/sdk": "sdk",
  "@bc-forge/cli": "cli",
  "@bc-forge/react": "react",
};

const ALLOWED = [
  /^package\/package\.json$/,
  /^package\/README\.md$/,
  /^package\/LICENSE$/,
  /^package\/dist\/.+$/,
];

function run(command, cwd) {
  return execSync(command, { cwd, stdio: ["ignore", "pipe", "inherit"] }).toString();
}

/**
 * Collect every `./relative/path` target reachable from an `exports` map so we
 * can assert that no published entry points at a file missing from the
 * tarball.
 */
function collectExportTargets(value, found = new Set()) {
  if (typeof value === "string") {
    if (value.startsWith("./")) found.add(value);
    return found;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectExportTargets(nested, found);
  }
  return found;
}

for (const [name, dir] of Object.entries(dirs)) {
  const pkgDir = path.join(root, dir);
  const packed = JSON.parse(run("npm pack --json --ignore-scripts", pkgDir));
  const entry = packed[0];
  const tarball = path.join(pkgDir, entry.filename);

  let sdkTarball = null;
  if (dir !== "sdk") {
    const sdkPkgDir = path.join(root, "sdk");
    const sdkPacked = JSON.parse(run("npm pack --json --ignore-scripts", sdkPkgDir));
    sdkTarball = path.join(sdkPkgDir, sdkPacked[0].filename);
  }

  const listed = run(`tar -tf "${entry.filename}"`, pkgDir)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const manifest = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const isDualPackage = typeof manifest.exports === "object" && manifest.exports !== null;

  if (isDualPackage) {
    const packedFiles = new Set(listed);
    const declarations = [];
    for (const target of collectExportTargets(manifest.exports)) {
      if (!packedFiles.has(target.replace(/^\.\//, "package/"))) {
        console.error(`${name} exports targets "${target}", which is missing from the tarball.`);
        rmSync(tarball, { force: true });
        process.exit(1);
      }
      if (/\.d\.[cm]?ts$/.test(target)) declarations.push(target);
    }
    if (declarations.length === 0) {
      console.error(`${name} exports map declares no "types" entry.`);
      rmSync(tarball, { force: true });
      process.exit(1);
    }
  }

  const rejected = listed.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
  if (rejected.length > 0) {
    console.error(`${name} tarball is outside the allowlist:`);
    for (const file of rejected) console.error(`  ${file}`);
    rmSync(tarball, { force: true });
    if (sdkTarball) rmSync(sdkTarball, { force: true });
    process.exit(1);
  }

  const consumer = mkdtempSync(path.join(tmpdir(), "bc-forge-consumer-"));
  try {
    run("npm init -y", consumer);
    const toInstall = sdkTarball ? `"${sdkTarball}" "${tarball}"` : `"${tarball}"`;
    run(`npm install ${toInstall}`, consumer);
    const esmProbe = path.join(consumer, "esm-probe.mjs");
    writeFileSync(
      esmProbe,
      `import(${JSON.stringify(name)}).then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
`,
    );
    run("node esm-probe.mjs", consumer);

    if (isDualPackage) {
      const cjsProbe = path.join(consumer, "cjs-probe.cjs");
      writeFileSync(cjsProbe, `require(${JSON.stringify(name)});\n`);
      run("node cjs-probe.cjs", consumer);
    }
    if (dir === "react") {
      execSync("node react/test-consumer/run-smoke-test.mjs", {
        cwd: root,
        stdio: "inherit",
      });
    }
    console.log(`${name} tarball allowlist and consumer import passed.`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
    rmSync(tarball, { force: true });
    if (sdkTarball) rmSync(sdkTarball, { force: true });
  }
}
