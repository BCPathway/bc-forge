/**
 * Post-publish verification for `@bc-forge/react` (#1046).
 *
 * A successful `npm publish` only proves the upload was accepted. It does not
 * prove that a consumer can install the exact published version, that the
 * `main`/`module` entries load, or that `dist/index.d.ts` resolves. This script
 * proves all three against the real registry, in a throwaway project that has
 * no relationship to this repository's workspace, lockfile, or `node_modules`.
 *
 * Checks, in order:
 *   1. `npm install <name>@<version>` in a clean temp project, retried to ride
 *      out registry propagation right after a publish.
 *   2. The installed version is exactly the version that was published.
 *   3. Runtime import: `require()` of the CJS entry and `import()` of the ESM
 *      entry both resolve and expose the public components.
 *   4. Minimal server render of a published component through
 *      `react-dom/server`.
 *   5. TypeScript type-check of a consumer component against the published
 *      declarations.
 *
 * On any failure the process exits non-zero so the calling CI job fails. It
 * never runs `npm unpublish`: the published version stays on the registry and
 * the fix ships as a new version.
 *
 * Usage:
 *   node scripts/verify-published-react.mjs --version 1.2.3
 *   node scripts/verify-published-react.mjs            # resolves the latest dist-tag
 *   node scripts/verify-published-react.mjs --spec ./bc-forge-react-1.2.3.tgz  # local dry run
 *
 * Options:
 *   --version <v>      exact published version to install (default: latest dist-tag)
 *   --package <name>   package to verify (default: @bc-forge/react)
 *   --attempts <n>     install attempts before giving up (default: 5)
 *   --retry-delay <s>  seconds to wait between attempts (default: 20)
 *   --spec <specs>     comma-separated install specs to use instead of
 *                      `<name>@<version>` (local dry runs only, never in CI)
 *   --keep             keep the temporary project for inspection
 */
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_PACKAGE = "@bc-forge/react";
const DEFAULT_ATTEMPTS = 5;
const DEFAULT_RETRY_DELAY_SECONDS = 20;

// Consumers of the published package need the peer runtime, and the type check
// needs a compiler. Ranges follow react/package.json so the temporary project
// mirrors what a real consumer installs.
const RUNTIME_DEPS = ["react@^19", "react-dom@^19"];
const TYPECHECK_DEPS = ["typescript@^6", "@types/react@^19", "@types/react-dom@^19"];

const COMPONENTS = ["Alert", "Badge", "Dropdown", "ConnectWallet"];

class VerificationError extends Error {}

function parseArgs(argv) {
  const options = {
    name: DEFAULT_PACKAGE,
    version: "",
    attempts: DEFAULT_ATTEMPTS,
    retryDelaySeconds: DEFAULT_RETRY_DELAY_SECONDS,
    spec: [],
    keep: false,
  };
  const VALUE_FLAGS = new Set([
    "--version",
    "--package",
    "--attempts",
    "--retry-delay",
    "--spec",
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--keep") {
      options.keep = true;
      continue;
    }
    if (!VALUE_FLAGS.has(flag)) throw new VerificationError(`unknown option: ${flag}`);
    const value = argv[i + 1];
    if (value === undefined) throw new VerificationError(`${flag} needs a value`);
    i += 1;
    if (flag === "--version") options.version = value;
    else if (flag === "--package") options.name = value;
    else if (flag === "--attempts") options.attempts = Number.parseInt(value, 10);
    else if (flag === "--retry-delay") options.retryDelaySeconds = Number.parseInt(value, 10);
    else {
      options.spec = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  if (!Number.isInteger(options.attempts) || options.attempts < 1) {
    throw new VerificationError("--attempts must be a positive integer");
  }
  if (!Number.isFinite(options.retryDelaySeconds) || options.retryDelaySeconds < 0) {
    throw new VerificationError("--retry-delay must be a non-negative number of seconds");
  }
  return options;
}

function run(command, cwd) {
  return execSync(command, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

function tail(text, lines = 20) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(-lines)
    .join("\n");
}

function describeError(error) {
  const parts = [error.message];
  const seen = new Set();
  for (const line of tail([error.stdout, error.stderr].filter(Boolean).join("\n"), 30).split(
    /\r?\n/,
  )) {
    if (seen.has(line)) continue;
    seen.add(line);
    parts.push(line);
  }
  return parts.join("\n");
}

function step(message) {
  console.log(`\n▸ ${message}`);
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function resolveLatestVersion(name) {
  try {
    return run(`npm view "${name}" version`, process.cwd()).trim();
  } catch (error) {
    throw new VerificationError(
      `could not read the latest published version of ${name} from the registry: ${describeError(error)}`,
    );
  }
}

function installWithRetries(cwd, specs, attempts, retryDelaySeconds) {
  const command = `npm install --no-audit --no-fund ${specs.map((spec) => `"${spec}"`).join(" ")}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      run(command, cwd);
      return;
    } catch (error) {
      // A fresh publish can take a moment to become installable. Drop any
      // half-written install so the next attempt starts from a clean tree.
      rmSync(path.join(cwd, "node_modules"), { recursive: true, force: true });
      rmSync(path.join(cwd, "package-lock.json"), { force: true });
      if (attempt >= attempts) {
        throw new VerificationError(
          `npm install ${specs.join(" ")} failed ${attempts} time(s), last error:\n${describeError(error)}`,
        );
      }
      console.log(
        `  attempt ${attempt}/${attempts} failed, waiting ${retryDelaySeconds}s for the registry to catch up`,
      );
      sleep(retryDelaySeconds * 1000);
    }
  }
}

function writeConsumerProject(projectDir, name) {
  writeFileSync(
    path.join(projectDir, "verify-runtime.mjs"),
    `// Generated by scripts/verify-published-react.mjs. Exercises the published
// runtime entries: the CommonJS "main" and the ESM "module" build.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const name = ${JSON.stringify(name)};
const required = ${JSON.stringify(COMPONENTS)};
const require = createRequire(import.meta.url);
const packageDir = path.join(process.cwd(), "node_modules", ...name.split("/"));
const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

console.log("  installed version:", manifest.version);
assert(manifest.main, "package.json has no \\"main\\" entry");
assert(manifest.module, "package.json has no \\"module\\" entry");
assert(manifest.types, "package.json has no \\"types\\" entry");

const cjs = require(name);
const esmEntry = manifest.module || manifest.main;
const esm = await import(pathToFileURL(path.join(packageDir, esmEntry)).href);

for (const component of required) {
  assert(cjs[component], \`"main" build of \${name} does not export \${component}\`);
  assert(esm[component], \`"module" build of \${name} does not export \${component}\`);
}

// Minimal server render from the CommonJS entry.
const cjsMarkup = renderToStaticMarkup(
  React.createElement(
    cjs.Alert,
    { variant: "success", title: "Post-publish verified" },
    "Installed from the registry.",
  ),
);
assert(cjsMarkup.includes('role="status"'), \`unexpected server render output: \${cjsMarkup}\`);
assert(cjsMarkup.includes("Post-publish verified"), \`unexpected server render output: \${cjsMarkup}\`);

// The same component from the ESM build must render too.
const esmMarkup = renderToStaticMarkup(
  React.createElement(esm.Alert, { variant: "danger", title: "Verified" }, "Body"),
);
assert(esmMarkup.includes('role="alert"'), \`unexpected ESM server render output: \${esmMarkup}\`);
assert(esmMarkup.includes("Verified"), \`unexpected ESM server render output: \${esmMarkup}\`);

console.log("  cjs markup:", cjsMarkup);
console.log("  esm entry:", esmEntry, "exports", Object.keys(esm).length);
console.log("  runtime import and server render passed");
`,
    "utf8",
  );

  writeFileSync(
    path.join(projectDir, "verify-types.tsx"),
    `// Generated by scripts/verify-published-react.mjs. Type-checks a consumer
// component against the declarations the registry serves.
import * as React from "react";
import { Alert, Badge } from ${JSON.stringify(name)};
import type { AlertProps, AlertVariant, BadgeProps } from ${JSON.stringify(name)};

const variant: AlertVariant = "success";
const alertProps: AlertProps = { variant, title: "Post-publish verified" };
const badgeProps: BadgeProps = { variant: "primary", size: "sm" };

export function Verified(): React.JSX.Element {
  return (
    <>
      <Alert {...alertProps}>Installed from the registry.</Alert>
      <Badge {...badgeProps}>live</Badge>
    </>
  );
}
`,
    "utf8",
  );

  writeFileSync(
    path.join(projectDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          // Consumers resolve the published "types" entry through bundler-style
          // resolution, which is what a Vite/Next/tsup app does.
          moduleResolution: "bundler",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          // Third-party declarations (@bc-forge/sdk, @stellar/stellar-sdk)
          // reference Node globals, so only the consumer file is checked.
          skipLibCheck: true,
          forceConsistentCasingInFileNames: true,
        },
        files: ["verify-types.tsx"],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function verifyInstalledVersion(projectDir, name, expected) {
  const manifestPath = path.join(projectDir, "node_modules", ...name.split("/"), "package.json");
  if (!existsSync(manifestPath)) {
    throw new VerificationError(`${name} is not present in ${projectDir}/node_modules after install`);
  }
  const installed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (installed.version !== expected) {
    throw new VerificationError(
      `expected ${name}@${expected} to be installed, found ${installed.version}`,
    );
  }
  return installed;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`\n✖ ${error.message}`);
    console.error("  See the usage block at the top of scripts/verify-published-react.mjs.");
    process.exitCode = 1;
    return;
  }

  const name = options.name;
  const expectedVersion = options.version || resolveLatestVersion(name);
  const specs = options.spec.length > 0 ? options.spec : [`${name}@${expectedVersion}`];

  console.log(`Post-publish verification of ${name}@${expectedVersion}`);
  if (options.spec.length > 0) {
    console.log(`  WARNING: --spec overrides the registry spec; CI must never pass --spec.`);
  }

  const projectDir = mkdtempSync(path.join(tmpdir(), "bc-forge-verify-react-"));
  try {
    step("Create a clean temporary project");
    run("npm init -y", projectDir);
    console.log(`  ${projectDir}`);

    step(`Install ${specs.join(" ")} (up to ${options.attempts} attempts)`);
    installWithRetries(
      projectDir,
      [...specs, ...RUNTIME_DEPS, ...TYPECHECK_DEPS],
      options.attempts,
      options.retryDelaySeconds,
    );

    step("Confirm the exact published version is installed");
    const manifest = verifyInstalledVersion(projectDir, name, expectedVersion);
    console.log(`  ${name}@${manifest.version} (main ${manifest.main}, module ${manifest.module}, types ${manifest.types})`);

    step("Write the consumer runtime and type-check files");
    writeConsumerProject(projectDir, name);

    step("Import the package and render a component on the server");
    run(`node "verify-runtime.mjs"`, projectDir).trimEnd().split(/\r?\n/).forEach((line) => console.log(line));

    step("Type-check a consumer component against the published declarations");
    run(
      `node "node_modules/typescript/bin/tsc" -p "tsconfig.json"`,
      projectDir,
    );
    console.log("  tsc --noEmit passed");

    console.log(`\n✔ ${name}@${expectedVersion} installs, imports, renders, and type-checks.`);
  } catch (error) {
    console.error(`\n✖ Post-publish verification failed for ${name}@${expectedVersion}`);
    console.error(error instanceof VerificationError ? `  ${error.message}` : describeError(error));
    console.error(
      "\n  The published version stays on the registry: this job never unpublishes.",
    );
    console.error("  Ship a fix as a new version (changeset + release run) and re-run the verification.");
    if (process.env.GITHUB_ACTIONS) {
      console.error(`::error::post-publish verification failed for ${name}@${expectedVersion}`);
    }
    if (options.keep) console.error(`  Temporary project kept at: ${projectDir}`);
    else console.error(`  Temporary project removed: ${projectDir}`);
    process.exitCode = 1;
  } finally {
    if (!options.keep) rmSync(projectDir, { recursive: true, force: true });
  }
}

main();
