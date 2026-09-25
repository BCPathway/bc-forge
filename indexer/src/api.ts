import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getPrismaClient } from './lib/prisma';
import { logger } from './lib/logger';

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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type PaginatedDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<Array<{ id: string }>>;
};

/**
 * Parse the `limit` query param.
 *
 * Returns the effective limit (capped at MAX_LIMIT) or `null` when the
 * caller supplied a non-integer or a value below 1.
 */
function parseLimit(query: Request['query']): number | null {
  const raw = query.limit;
  if (raw === undefined) {
    return DEFAULT_LIMIT;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, MAX_LIMIT);
}

/**
 * Extract the `cursor` query param (the id of the last row from the
 * previous page). Empty or missing values mean "first page".
 */
function parseCursor(query: Request['query']): string | undefined {
  const raw = query.cursor;
  if (raw === undefined) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * Extract the optional `address` query param.
 * Empty or missing values return undefined (no filter).
 */
function parseAddress(query: Request['query']): string | undefined {
  const raw = query.address;
  if (raw === undefined) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}

/**
 * Extract the optional `from_ledger` query param.
 *
 * Returns the ledger number, `undefined` when absent, or `null` when
 * the supplied value is not a valid non-negative integer.
 */
function parseFromLedger(query: Request['query']): number | null | undefined {
  const raw = query.from_ledger;
  if (raw === undefined) {
    return undefined;
  }
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

/**
 * Build the Prisma `where` filter object for a Mint row.
 *
 * Mints have a `to` address field. An address filter matches that field.
 */
function buildMintWhere(
  address: string | undefined,
  fromLedger: number | undefined,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];
  if (address !== undefined) {
    conditions.push({ to: address });
  }
  if (fromLedger !== undefined) {
    conditions.push({ ledger: { gte: fromLedger } });
  }
  if (conditions.length === 0) {
    return undefined;
  }
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

/**
 * Build the Prisma `where` filter object for a Transfer row.
 *
 * Transfers have both a `from` and a `to` address field. An address filter
 * matches either side (OR semantics).
 */
function buildTransferWhere(
  address: string | undefined,
  fromLedger: number | undefined,
): Record<string, unknown> | undefined {
  const andConditions: Record<string, unknown>[] = [];
  if (address !== undefined) {
    andConditions.push({ OR: [{ from: address }, { to: address }] });
  }
  if (fromLedger !== undefined) {
    andConditions.push({ ledger: { gte: fromLedger } });
  }
  if (andConditions.length === 0) {
    return undefined;
  }
  return andConditions.length === 1 ? andConditions[0] : { AND: andConditions };
}

/**
 * Build the Prisma `where` filter object for a Burn row.
 *
 * Burns have a `from` address field. An address filter matches that field.
 */
function buildBurnWhere(
  address: string | undefined,
  fromLedger: number | undefined,
): Record<string, unknown> | undefined {
  const conditions: Record<string, unknown>[] = [];
  if (address !== undefined) {
    conditions.push({ from: address });
  }
  if (fromLedger !== undefined) {
    conditions.push({ ledger: { gte: fromLedger } });
  }
  if (conditions.length === 0) {
    return undefined;
  }
  return conditions.length === 1 ? conditions[0] : { AND: conditions };
}

/**
 * Shared cursor-paginated list handler.
 *
 * Ordering is `createdAt DESC, id DESC` so pages stay stable when several
 * rows share the same timestamp. We fetch `limit + 1` rows to detect
 * whether another page exists without ever returning more than `limit`
 * rows to the caller.
 *
 * Optional `where` is forwarded directly to Prisma to filter by address
 * and/or ledger without affecting cursor semantics.
 */
async function handlePaginatedList(
  req: Request,
  res: Response,
  delegate: PaginatedDelegate,
  where?: Record<string, unknown>,
): Promise<void> {
  const limit = parseLimit(req.query);
  if (limit === null) {
    res.status(400).json({ error: 'Invalid limit: must be an integer >= 1' });
    return;
  }
  const cursor = parseCursor(req.query);

  let rows: Array<{ id: string }>;
  try {
    rows = await delegate.findMany({
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      ...(where ? { where } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2025'
    ) {
      res.status(400).json({ error: 'Invalid cursor' });
      return;
    }
    throw err;
  }

  const hasNextPage = rows.length > limit;
  const data = hasNextPage ? rows.slice(0, limit) : rows;
  res.json({
    data,
    nextCursor: hasNextPage && data.length > 0 ? data[data.length - 1].id : null,
  });
}

/**
 * Wrap an async route handler so rejected promises reach Express error
 * middleware via `next(err)` instead of becoming unhandled rejections
 * (Express 4 does not forward async errors on its own). Works for any
 * thrown value, including non-Error rejections.
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}

/**
 * Shared JSON error handler. Register after the API router (and any other
 * routes) so every forwarded error lands here.
 *
 * Logs one structured JSON line with the request method and path, then
 * responds with HTTP 500 and a fixed body. Stack traces and error details
 * stay in the server logs and are never sent to the client. Authorization
 * headers and connection strings are never logged.
 */
export function jsonErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  logger.error('request failed', {
    method: req.method,
    path: req.path,
    error: err instanceof Error ? err.message : String(err),
  });

  if (res.headersSent) {
    next(err);
    return;
  }

  res.status(500).json({ error: 'internal_error' });
}

/**
 * GET /mints
 * Retrieve mint logs (paginated, optionally filtered).
 *
 * Query params:
 *   address     — filter by `to` address
 *   from_ledger — include only rows with ledger >= this value
 *   limit       — page size (default 50, max 100)
 *   cursor      — opaque cursor from a previous response's `nextCursor`
 */
router.get(
  '/mints',
  asyncHandler(async (req, res) => {
    const address = parseAddress(req.query);
    const fromLedger = parseFromLedger(req.query);
    if (fromLedger === null) {
      res.status(400).json({ error: 'Invalid from_ledger: must be a non-negative integer' });
      return;
    }
    const where = buildMintWhere(address, fromLedger);
    await handlePaginatedList(req, res, getPrismaClient().mint, where);
  }),
);

/**
 * GET /transfers
 * Retrieve transfer logs (paginated, optionally filtered).
 *
 * Query params:
 *   address     — filter by `from` OR `to` address
 *   from_ledger — include only rows with ledger >= this value
 *   limit       — page size (default 50, max 100)
 *   cursor      — opaque cursor from a previous response's `nextCursor`
 */
router.get(
  '/transfers',
  asyncHandler(async (req, res) => {
    const address = parseAddress(req.query);
    const fromLedger = parseFromLedger(req.query);
    if (fromLedger === null) {
      res.status(400).json({ error: 'Invalid from_ledger: must be a non-negative integer' });
      return;
    }
    const where = buildTransferWhere(address, fromLedger);
    await handlePaginatedList(req, res, getPrismaClient().transfer, where);
  }),
);

/**
 * GET /burns
 * Retrieve burn logs (paginated, optionally filtered).
 *
 * Query params:
 *   address     — filter by `from` address
 *   from_ledger — include only rows with ledger >= this value
 *   limit       — page size (default 50, max 100)
 *   cursor      — opaque cursor from a previous response's `nextCursor`
 */
router.get(
  '/burns',
  asyncHandler(async (req, res) => {
    const address = parseAddress(req.query);
    const fromLedger = parseFromLedger(req.query);
    if (fromLedger === null) {
      res.status(400).json({ error: 'Invalid from_ledger: must be a non-negative integer' });
      return;
    }
    const where = buildBurnWhere(address, fromLedger);
    await handlePaginatedList(req, res, getPrismaClient().burn, where);
  }),
);

/**
 * GET /stats
 * Retrieve basic token operation stats.
 */
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
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
  }),
);

export default router;
