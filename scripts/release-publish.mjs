// Publish sequence for the Release workflow (.github/workflows/release.yml).
//
// changesets/action runs its `publish` input as ONE command: it splits the
// string on whitespace and execs the first token with the rest as arguments.
// A multi-line YAML block therefore becomes a single `npm run build
// --workspace @bc-forge/sdk npm run build ...` call and fails with
// "No workspaces found". Every step lives here instead, and the action is
// given `npm run release:publish`.
//
// Order matters: builds first, then the React tarball check, then the npm
// guards, then the React dist-tag publish, then Changesets for the rest.
// `changeset publish` must be last and its stdout must stay attached so the
// action can read the "New tag:" lines into its `publishedPackages` output.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  "npm run build --workspace @bc-forge/sdk",
  "npm run build --workspace @bc-forge/cli",
  "npm run build --workspace @bc-forge/react",
  "npm run prisma:generate --workspace @bc-forge/indexer",
  "npm run build --workspace @bc-forge/indexer",
  "node scripts/validate-react-tarball.mjs",
  "npm config set provenance true",
  "node scripts/check-version-tag.mjs --before-changeset-publish",
  "node scripts/react-dist-tag.mjs --publish-react",
  "npx changeset publish",
];

for (const command of steps) {
  console.log(`\n=== release:publish: ${command} ===`);
  execSync(command, { cwd: root, stdio: "inherit" });
}
