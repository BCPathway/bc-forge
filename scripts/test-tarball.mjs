import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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

for (const [name, dir] of Object.entries(dirs)) {
  const pkgDir = path.join(root, dir);
  const packed = JSON.parse(run("npm pack --json --ignore-scripts", pkgDir));
  const entry = packed[0];
  const tarball = path.join(pkgDir, entry.filename);
  const listed = run(`tar -tf "${entry.filename}"`, pkgDir)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rejected = listed.filter((file) => !ALLOWED.some((pattern) => pattern.test(file)));
  if (rejected.length > 0) {
    console.error(`${name} tarball is outside the allowlist:`);
    for (const file of rejected) console.error(`  ${file}`);
    rmSync(tarball, { force: true });
    process.exit(1);
  }

  const consumer = mkdtempSync(path.join(tmpdir(), "bc-forge-consumer-"));
  try {
    run("npm init -y", consumer);
    run(`npm install "${tarball}"`, consumer);
    const importCheck = `
      import("${name}").then(() => process.exit(0)).catch((err) => {
        console.error(err);
        process.exit(1);
      });
    `;
    execSync(`node --input-type=module -e ${JSON.stringify(importCheck)}`, {
      cwd: consumer,
      stdio: "inherit",
    });
    console.log(`${name} tarball allowlist and consumer import passed.`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
    rmSync(tarball, { force: true });
  }
}
