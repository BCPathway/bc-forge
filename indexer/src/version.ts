import type { Request, Response } from 'express';

/**
 * Build metadata reported by the indexer (issue #1047).
 *
 * The values are baked into the container image at build time (see
 * `indexer/Dockerfile`) from `BUILD_*` arguments supplied by the publishing
 * workflow, so an operator can tell exactly which commit and release a running
 * container came from.
 *
 * Only these fields are ever read: `process.env` as a whole is never
 * serialized, so a database URL, API token, or any other injected secret
 * cannot leak through this endpoint.
 */

/** Placeholder used when a build argument was not supplied. */
export const UNKNOWN_BUILD_VALUE = 'unknown';

/** Name reported when the image was not built by the publishing workflow. */
const DEFAULT_NAME = 'bc-forge-indexer';

/** Canonical repository, used when `BUILD_SOURCE` was not supplied. */
const DEFAULT_SOURCE = 'https://github.com/BCPathway/bc-forge';

/** Shape of the `GET /version` response body. */
export interface BuildInfo {
  /** Service name. */
  name: string;
  /** Released version of the indexer, e.g. `1.2.3`. */
  version: string;
  /** Git SHA of the source the image was built from. */
  revision: string;
  /** ISO-8601 timestamp of the image build. */
  buildDate: string;
  /** Repository the image was built from. */
  source: string;
}

function envOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Read the build metadata out of the environment.
 *
 * Unset or blank `BUILD_*` variables degrade to `unknown` (or to the fixed
 * defaults for `name`/`source`) so a locally started container still answers
 * with a well-formed body instead of `undefined`.
 */
export function getBuildInfo(): BuildInfo {
  return {
    name: envOr(process.env.BUILD_NAME, DEFAULT_NAME),
    version: envOr(process.env.BUILD_VERSION, UNKNOWN_BUILD_VALUE),
    revision: envOr(process.env.BUILD_REVISION, UNKNOWN_BUILD_VALUE),
    buildDate: envOr(process.env.BUILD_DATE, UNKNOWN_BUILD_VALUE),
    source: envOr(process.env.BUILD_SOURCE, DEFAULT_SOURCE),
  };
}

/**
 * `GET /version` — unauthenticated build-metadata endpoint.
 *
 * Registered outside the `/api/v1` router and without `requireApiToken` so an
 * operator can identify a running container without holding the API token. The
 * body is built exclusively from the `BUILD_*` allowlist above, so no secret
 * reaches the client.
 *
 * - 200 — build metadata, always.
 */
export function versionHandler(_req: Request, res: Response): void {
  res.status(200).json(getBuildInfo());
}
