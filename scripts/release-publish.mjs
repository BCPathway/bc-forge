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
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Clean up any masked placeholder or empty NODE_AUTH_TOKEN from setup-node
// so npm does not send invalid token credentials instead of performing OIDC.
if (
  process.env.NODE_AUTH_TOKEN &&
  (/^X+-(?:X+-?)+$/i.test(process.env.NODE_AUTH_TOKEN) ||
    !process.env.NODE_AUTH_TOKEN.trim())
) {
  delete process.env.NODE_AUTH_TOKEN;
}

// If NPM_TOKEN is provided and NODE_AUTH_TOKEN is missing,
// map NPM_TOKEN into NODE_AUTH_TOKEN for tools that expect it.
if (process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
  process.env.NODE_AUTH_TOKEN = process.env.NPM_TOKEN;
}

// If NPM_CONFIG_USERCONFIG points to a generated .npmrc containing always-auth
// or unbound token placeholders without a real token, remove it so OIDC succeeds.
if (
  process.env.NPM_CONFIG_USERCONFIG &&
  fs.existsSync(process.env.NPM_CONFIG_USERCONFIG)
) {
  try {
    const configContent = fs.readFileSync(
      process.env.NPM_CONFIG_USERCONFIG,
      "utf8",
    );
    if (
      configContent.includes("always-auth") ||
      configContent.includes("${NODE_AUTH_TOKEN}") ||
      configContent.includes("XXXXX-XXXXX")
    ) {
      if (!process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN) {
        delete process.env.NPM_CONFIG_USERCONFIG;
      }
    }
  } catch {
    // Ignore read errors
  }
}

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
  if (command === "npx changeset publish") {
    try {
      execSync(command, { cwd: root, stdio: "inherit" });
    } catch (error) {
      if (process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN) {
        console.warn(
          "\n=== Changeset publish with provenance failed. Retrying with token fallback (provenance=false) ===",
        );
        execSync("npm config set provenance false", {
          cwd: root,
          stdio: "inherit",
        });
        execSync(command, { cwd: root, stdio: "inherit" });
      } else {
        throw error;
      }
    }
  } else {
    execSync(command, { cwd: root, stdio: "inherit" });
  }
}
