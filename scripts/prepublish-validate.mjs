import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "@bc-forge/sdk",
  "@bc-forge/cli",
  "@bc-forge/react",
  "@bc-forge/indexer",
];

function run(command) {
  execSync(command, { cwd: root, stdio: "inherit" });
}

run("npm ci");

for (const name of packages) {
  console.log(`\n=== ${name}: install is done; build, test, pack ===`);
  run(`npm run build --workspace ${name}`);
  run(`npm test --workspace ${name}`);
  run(`npm pack --dry-run --workspace ${name}`);
}

console.log("\n=== generated-file drift ===");
try {
  run("git diff --exit-code");
} catch {
  console.error(
    "Uncommitted generated diff after build and test. Commit the generated files or fix the generator.",
  );
  process.exit(1);
}

console.log("Prepublish validation passed.");
