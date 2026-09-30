#!/usr/bin/env node
/**
 * Tag validation script for bc-forge component publishing.
 *
 * Validates that a tag matches exactly one component's tag pattern.
 * Used to verify tag conventions and test workflow routing.
 */

const COMPONENTS = [
  { name: "sdk", prefix: "sdk-v", workflow: "release.yml" },
  { name: "cli", prefix: "cli-v", workflow: "release.yml" },
  { name: "react", prefix: "react-v", workflow: "release.yml" },
  { name: "indexer", prefix: "indexer-v", workflow: "publish-indexer.yml" },
];

function validateTag(tag) {
  const matches = COMPONENTS.filter((c) => tag.startsWith(c.prefix));

  if (matches.length === 0) {
    return { valid: false, component: null, error: `Tag "${tag}" does not match any component pattern` };
  }

  if (matches.length > 1) {
    return {
      valid: false,
      component: null,
      error: `Tag "${tag}" matches multiple components: ${matches.map((m) => m.name).join(", ")}`,
    };
  }

  const component = matches[0];
  const version = tag.slice(component.prefix.length);

  // Basic semver validation
  const semverRegex = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
  const semverMatch = version.match(semverRegex);

  if (!semverMatch) {
    return {
      valid: false,
      component: component.name,
      error: `Version "${version}" is not a valid semver`,
    };
  }

  return {
    valid: true,
    component: component.name,
    version,
    workflow: component.workflow,
  };
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: node scripts/validate-tag.js <tag> [tag...]");
    console.error("");
    console.error("Examples:");
    console.error("  node scripts/validate-tag.js sdk-v1.0.0");
    console.error("  node scripts/validate-tag.js sdk-v1.0.0 cli-v2.0.0 react-v1.0.0-beta.1");
    process.exit(1);
  }

  let hasErrors = false;

  for (const tag of args) {
    const result = validateTag(tag);

    if (result.valid) {
      console.log(`${tag} -> ${result.component} (version: ${result.version}, workflow: ${result.workflow})`);
    } else {
      console.error(`ERROR: ${result.error}`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { validateTag, COMPONENTS };