// One-time first publish for packages that do not exist on npm yet.
//
// npm trusted publishing (OIDC) cannot create a package: the publish PUT for
// an unknown name fails with a bare E404. Each package therefore needs one
// token-authenticated publish before release.yml can take over with OIDC.
// This script is run by .github/workflows/bootstrap-npm-publish.yml with
// NODE_AUTH_TOKEN set from the `npm` environment's NPM_TOKEN secret.
//
// It is idempotent: a package already on the registry is skipped, so rerunning
// it after the bootstrap publishes nothing. Changesets stays the only
// publisher for every version after the first.
//
// Usage: node scripts/bootstrap-npm-publish.mjs [--dry-run] [--only sdk,cli]
import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PACKAGES = [
  { name: "@bc-forge/sdk", dir: "sdk" },
  { name: "@bc-forge/cli", dir: "cli" },
  { name: "@bc-forge/react", dir: "react" },
  { name: "@bc-forge/indexer", dir: "indexer" },
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyIndex = args.indexOf("--only");
const only =
  onlyIndex === -1
    ? null
    : new Set(
        (args[onlyIndex + 1] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );

if (!dryRun && !process.env.NODE_AUTH_TOKEN) {
  console.error(
    "NODE_AUTH_TOKEN is empty. Store a granular npm token with publish rights " +
      "on the @bc-forge scope as NPM_TOKEN on the `npm` GitHub environment, " +
      "or pass --dry-run to only report what would be published.",
  );
  process.exit(1);
}

/** Returns true when the package name is already registered on npm. */
function existsOnRegistry(name) {
  // Names come from the constant list above, so a single shell string is safe
  // and works for npm.cmd on Windows as well as npm on Linux runners.
  const result = spawnSync(`npm view ${name} name --json`, {
    cwd: root,
    encoding: "utf8",
    shell: true,
  });
  if (result.status === 0) return true;
  const stderr = `${result.stderr ?? ""}${result.stdout ?? ""}`;
  if (/E404|code E404|Not Found|404/i.test(stderr)) return false;
  throw new Error(`npm view ${name} failed:\n${stderr}`);
}

function versionOf(dir) {
  const pkg = JSON.parse(
    readFileSync(path.join(root, dir, "package.json"), "utf8"),
  );
  return pkg.version;
}

let published = 0;
let skipped = 0;

for (const { name, dir } of PACKAGES) {
  if (only && !only.has(dir) && !only.has(name)) continue;

  const version = versionOf(dir);
  if (existsOnRegistry(name)) {
    console.log(`skip    ${name} already exists on npm; release.yml owns it now.`);
    skipped += 1;
    continue;
  }

  const command = [
    "npm publish",
    `--workspace ${name}`,
    "--access public",
    "--provenance",
    dryRun ? "--dry-run" : "",
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`\n=== ${dryRun ? "dry-run" : "publish"} ${name}@${version} ===`);
  console.log(command);
  execSync(command, { cwd: root, stdio: "inherit" });
  published += 1;
}

console.log(
  `\nBootstrap ${dryRun ? "dry run " : ""}done: ${published} published, ${skipped} already on npm.`,
);
if (published === 0 && skipped > 0) {
  console.log(
    "Nothing left to bootstrap. Add the trusted publisher on npmjs.com for each package, then revoke NPM_TOKEN.",
  );
}
