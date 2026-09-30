# Release checklist

`@bc-forge/sdk`, `@bc-forge/cli`, and `@bc-forge/react` publish from
[`.github/workflows/release.yml`](../.github/workflows/release.yml) on a push to
`main`. Changesets opens the version PR, and the publish step builds each
package, sets `npm config set provenance true`, and runs `npx changeset publish`.

The workflow grants `id-token: write` so npm can verify the GitHub Actions OIDC
token. It does not pass `NODE_AUTH_TOKEN`. A long-lived npm token is not part of
the normal publish path.

## One-time npm trusted-publisher setup

Do this once per package (`@bc-forge/sdk`, `@bc-forge/cli`, `@bc-forge/react`)
in the npm organization that owns the scope:

1. Sign in to [npmjs.com](https://www.npmjs.com) as an owner of the `bc-forge` organization.
2. Open the package, then **Settings → Trusted Publisher**.
3. Add a GitHub Actions publisher:
   - Organization or user: `BCPathway`
   - Repository: `bc-forge`
   - Workflow filename: `release.yml`
   - Environment name: `npm`
4. Save. Repeat for the other two packages.
5. Confirm **Access** is public for each package. The changesets config sets `"access": "public"`.
6. After the next release, open the package's **Versions** page and confirm the version shows a provenance attestation. The statement is also linked from the GitHub Actions run of `Release packages`.

Provenance is requested by `npm config set provenance true` before `changeset publish`. Pull requests do not publish.

## Protected environments and workflow permissions

Release publish workflows enforce least-privilege permissions and require deployment through protected GitHub Environments.

### Named GitHub Environments

1. **`npm` Environment**:
   - Referenced by the Changesets publish job in [`release.yml`](../.github/workflows/release.yml). That job is the npm publisher for `@bc-forge/sdk`, `@bc-forge/cli`, and `@bc-forge/react`. This repository does not add separate `publish-sdk.yml` or `publish-cli.yml` workflows, because a second publisher on `release: published` would publish those packages again after Changesets creates the GitHub Release.
   - npm trusted publishing uses GitHub OIDC. The publisher record on npmjs must use workflow filename `release.yml` and environment name `npm`. The job grants `id-token: write` and does not send `NODE_AUTH_TOKEN` on the normal path.
   - Fallback secret: store `NPM_TOKEN` as a secret on the `npm` environment, not as a repository-wide secret, and only wire it into the Changesets step for a one-off fallback publish.
2. **`container` Environment**:
   - Referenced by [`publish-release-manifest.yml`](../.github/workflows/publish-release-manifest.yml), which builds the indexer image and attaches the image digest plus release assets.
   - A future GHCR push workflow must use this same `container` environment, authenticate with `GITHUB_TOKEN`, and must not reuse npm secrets.

### GitHub Repository Settings & Required Reviewers

These settings cannot be expressed in workflow YAML. Configure them under **Settings → Environments**:

- **Required reviewers**: enable required reviewers on both `npm` and `container` so a release maintainer must approve the job before it publishes.
- **Deployment branches**: allow `main` for `release.yml`. Allow the release tags that trigger `publish-release-manifest.yml`.
- **Environment secrets**: `NPM_TOKEN` belongs on `npm` only. The container job uses the built-in `GITHUB_TOKEN` and does not need an npm token or any other secret.

### Workflow Permissions Inventory

Publish workflows set top-level `permissions: {}` so every unspecified `GITHUB_TOKEN` permission is `none`. Each job then opts into only what it uses:

- **`release.yml`** (`release` job, environment `npm`):
  - `contents: write` (push release commits and tags)
  - `id-token: write` (OIDC token for npm provenance)
  - `pull-requests: write` (open and update the Changesets version PR)
- **`publish-release-manifest.yml`** (`manifest` job, environment `container`):
  - `contents: write` (upload the indexer image digest, checksums, and release assets)

Any later component publisher must keep `permissions: {}` at the workflow root, declare job permissions explicitly, and select `environment: npm` or `environment: container`. It must not grant `packages: write` to an npm job or `id-token: write` to a container job unless that job needs it.

## Fallback secret and rotation

Use a granular npm token only when trusted publishing is unavailable (for example, the publisher record has not been created yet).

1. On npm, create a **granular access token** that can publish only `@bc-forge/sdk`, `@bc-forge/cli`, and `@bc-forge/react`. Do not create a classic token with access to every package you own.
2. Store it as the `NPM_TOKEN` Actions secret on `BCPathway/bc-forge`.
3. In `.github/workflows/release.yml`, add `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` to the Changesets step, publish the pending release, then remove that line so later releases go back to OIDC.
4. Rotate the secret after that publish, and after any exposure:
   - Revoke the token on npm (**Access Tokens → Revoke**).
   - Create a replacement granular token with the same package list.
   - Update the `NPM_TOKEN` repository secret. GitHub does not show the old value; replacing the secret is the rotation.
   - Delete the secret entirely once trusted publishing is confirmed on a release page.

Do not leave `NODE_AUTH_TOKEN` in the workflow after the fallback publish. A provenance publish that always sends a long-lived token is not trusted publishing.

## Verify a release

[`.github/workflows/publish-release-manifest.yml`](../.github/workflows/publish-release-manifest.yml) runs when a GitHub Release is published. It builds `@bc-forge/sdk`, `@bc-forge/cli`, and `@bc-forge/react`, packs each tarball, builds `bc_forge_token.wasm`, and builds the indexer image. It attaches `checksums.txt`, `manifest.json`, the three tarballs, and the token WASM to that release. `manifest.json` lists every one of those files with its component, version, filename, and SHA-256 checksum, plus the indexer image name and `containerimage.digest`.

Download `checksums.txt` and the artifacts into the same directory, then recompute the checksums.

Linux:

```bash
sha256sum -c checksums.txt
```

macOS:

```bash
shasum -a 256 -c checksums.txt
```

Windows PowerShell:

```powershell
Get-Content checksums.txt | ForEach-Object {
  $hash, $name = $_ -split '\s+', 2
  $actual = (Get-FileHash -Algorithm SHA256 -Path $name).Hash.ToLower()
  if ($actual -ne $hash) { throw "$name checksum mismatch" }
  Write-Output "$name OK"
}
```

A matching command prints `OK` for each file. A mismatch prints a checksum error and a non-zero exit status.

The indexer entry in `manifest.json` uses `digest` (`sha256:...`) rather than a filename. Compare that value to `containerimage.digest` in the "Build indexer image and record its digest" log of the release workflow. That digest is the image built for the release; it is not a GHCR pull digest, because this repository does not push the indexer image.

## Deliverable checklist

Use this list before and after a release. Migration and upgrade steps stay in [UPGRADE_GUIDE.md](./UPGRADE_GUIDE.md); do not copy them here.

### SDK (`@bc-forge/sdk`, npm)

- [ ] Version and changelog match the changeset.
- [ ] `npm test` and `npm run build` pass in `sdk/`.
- [ ] Verify: `npm view @bc-forge/sdk@<version> version` equals that version, and the release-manifest checksum matches the packed tarball.
- [ ] Rollback: do not republish the version. Deprecate it (`npm deprecate @bc-forge/sdk@<version> "reason"`) and publish a patched version. Point consumers at [UPGRADE_GUIDE.md](./UPGRADE_GUIDE.md).

### CLI (`@bc-forge/cli`, npm)

- [ ] Tests and `npm run build` pass in `cli/`.
- [ ] Verify: a clean install of that exact version runs `bc-forge --help`.
- [ ] Rollback: deprecate the bad version and publish a patch. Do not reuse the version number.

### React (`@bc-forge/react`, npm)

- [ ] `npm test` and `npm run build` pass in `react/`.
- [ ] Verify: a clean project installs the exact version and imports a component from the package.
- [ ] Rollback: deprecate the version and publish a patch. Do not unpublish.

### Indexer (service and image)

- [ ] `prisma migrate deploy` applies `indexer/prisma/migrations` in timestamp order before the process serves traffic.
- [ ] Verify: `GET /health` is ok and `GET /healthz` lag matches the indexer runbook.
- [ ] Rollback: redeploy the previous image digest. If the new schema cannot be read by that image, restore the database backup taken before the migration.

### Contract WASM

- [ ] The token WASM build is within budget and the release manifest records its checksum.
- [ ] Verify: the installed bytecode hash matches the manifest.
- [ ] Rollback: redeploy the previous WASM only when [UPGRADE_GUIDE.md](./UPGRADE_GUIDE.md) says that contract allows it. Otherwise pause and follow that guide.

### Docs

- [ ] `npm run docs:build` passes.
- [ ] Verify: the published site matches the release commit.
- [ ] Rollback: revert the docs commit and redeploy the previous site build. Package and WASM rollbacks stay on their own artifacts.

npm versions and published WASM are immutable, so their rollback is a new version plus deprecation or a documented contract downgrade. Images and the database roll back to a previous digest or backup.

## Post-publish verification (#1046)

The release manifest above verifies the artifacts attached to a GitHub Release.
This section covers the other half: proving that what reached **npm** is
installable, because a successful `npm publish` does not prove the registry
artifact is installable or that its declarations resolve.

`release.yml` reads the version from the Changesets output and calls
[`.github/workflows/verify-react-release.yml`](../.github/workflows/verify-react-release.yml),
which runs `scripts/verify-published-react.mjs`. That script creates a throwaway
project outside this repository, installs `<name>@<published version>` from npm
(retried to ride out registry propagation), and then:

1. asserts the installed version is exactly the published one,
2. `require()`s the CommonJS entry and `import()`s the ESM entry,
3. renders a published component with `react-dom/server`,
4. type-checks a consumer component against the published `dist/index.d.ts`.

The job is skipped when a release does not publish `@bc-forge/react`, and it can
be dispatched by hand from the **Actions** tab to re-verify a version that has
already shipped.

Run the same check locally:

```bash
npm run verify:published -- --version 1.0.0   # one exact version
npm run verify:published                      # latest published version
```

If it fails, the published version stays on npm: the script never unpublishes.
Add a changeset, let the release workflow ship a fixed version, and re-run the
verification.

## Rerun behavior

`.github/workflows/release.yml` publishes npm packages on push to `main`. It does not push images to GHCR. `publish-sdk.yml` and `publish-cli.yml` are not on `main`. SDK, CLI, React, and the indexer package publish through this Changesets workflow.

Concurrency is per component on the publish guard (`publish-sdk`, `publish-cli`, `publish-react`, `publish-indexer`) plus `publish-changesets` for the release job. `cancel-in-progress` is false on each group. A second push waits. It cannot cancel a publish that has already started, and one component's release does not cancel another's.

Before `changeset publish`, `scripts/check-version-tag.mjs --before-changeset-publish` queries npm for each package's exact version:

- The version is not on npm: publish continues.
- The exact version is already published and the registry version matches the intended version, including a tarball: the command exits 0. Changesets will not publish that version again. A rerun is a no-op.
- The version is already on npm but the registry version or tarball does not match the intended version: the command fails. Do not force-publish over the conflicting artifact.

A direct tag check (`node scripts/check-version-tag.mjs sdk@1.2.3`) still rejects a version that is already on npm. The release path above is the one that treats a matching republish as a no-op.

Re-run the failed Release workflow from the Actions tab after fixing the commit. A successful rerun of a commit whose versions are already on npm with the same version exits 0 and does not publish a second copy.
