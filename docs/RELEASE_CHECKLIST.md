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
   - Environment name: leave empty unless a GitHub Environment is added to the release job later
4. Save. Repeat for the other two packages.
5. Confirm **Access** is public for each package. The changesets config sets `"access": "public"`.
6. After the next release, open the package's **Versions** page and confirm the version shows a provenance attestation. The statement is also linked from the GitHub Actions run of `Release packages`.

Provenance is requested by `npm config set provenance true` before `changeset publish`. Pull requests do not publish.

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
