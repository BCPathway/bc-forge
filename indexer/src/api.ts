import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getPrismaClient } from './lib/prisma';

/**
 * Authenticated indexer read API.
 *
 * Every route below requires a shared secret supplied as a bearer token:
 *
 *   INDEXER_API_TOKEN=<secret>   # environment variable, loaded via dotenv
 *   Authorization: Bearer <secret>
 *
 * Requests with a missing or incorrect token receive HTTP 401. The configured
 * token is never logged. The `GET /health` probe in `index.ts` is registered
 * outside this router and stays unauthenticated so uptime checks keep working.
 */
const BEARER_PREFIX = 'Bearer ';

/**
 * Constant-time comparison of the presented token against the configured one.
 */
function tokensMatch(presented: string, expected: string): boolean {
  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);

  if (presentedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(presentedBuffer, expectedBuffer);
}

/**
 * Rejects requests that do not carry the configured bearer token.
 *
 * The expected token is read from the environment on every request so that
 * dotenv has finished loading and tests can configure it per run.
 */
export function requireApiToken(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.INDEXER_API_TOKEN;
  const header = req.get('authorization') ?? '';
  const presentedToken = header.startsWith(BEARER_PREFIX)
    ? header.slice(BEARER_PREFIX.length)
    : '';

  if (!expectedToken || !presentedToken || !tokensMatch(presentedToken, expectedToken)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

const router = express.Router();

router.use(requireApiToken);

/**
 * GET /mints
 * Retrieve mint logs.
 */
router.get('/mints', async (req, res) => {
  const mints = await getPrismaClient().mint.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(mints);
});

/**
 * GET /transfers
 * Retrieve transfer logs.
 */
router.get('/transfers', async (req, res) => {
  const transfers = await getPrismaClient().transfer.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(transfers);
});

/**
 * GET /burns
 * Retrieve burn logs.
 */
router.get('/burns', async (req, res) => {
  const burns = await getPrismaClient().burn.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(burns);
});

/**
 * GET /stats
 * Retrieve basic token operation stats.
 */
router.get('/stats', async (req, res) => {
  const prisma = getPrismaClient();
  const [mintCount, transferCount, burnCount] = await Promise.all([
    prisma.mint.count(),
    prisma.transfer.count(),
    prisma.burn.count(),
  ]);

  res.json({
    mintCount,
    transferCount,
    burnCount,
  });
});

export default router;
