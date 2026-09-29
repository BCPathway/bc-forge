import type { Request, Response } from 'express';
import { pingDatabase } from './lib/prisma';
import { logger } from './lib/logger';

/**
 * `GET /health` — database readiness probe.
 *
 * Registered outside the `/api/v1` router and without `requireApiToken` so
 * hosting probes never need the API token. Responses are fixed literals and
 * carry no error text, so no database URL, credential, or driver message can
 * leak to the client. Failures are logged server-side via `logger`, which
 * redacts credential-like fields and scrubs connection strings and bearer
 * tokens embedded in error messages.
 *
 * - 200 `{ status: 'ok' }`    — the `SELECT 1` ping succeeded.
 * - 503 `{ status: 'error' }` — the ping threw (e.g. wrong `DATABASE_URL`
 *   or the database is down). Hosting probes must treat this as unhealthy.
 */
export async function healthHandler(_req: Request, res: Response): Promise<void> {
  try {
    await pingDatabase();
    res.status(200).json({ status: 'ok' });
  } catch (err: unknown) {
    logger.error('health check failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(503).json({ status: 'error' });
  }
}
