import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

/** Default window length: one minute. */
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

/** Default quota: 60 requests per window per client IP. */
export const DEFAULT_RATE_LIMIT_MAX = 60;

/**
 * Parses a positive integer from an environment variable, falling back to the
 * supplied default when the value is missing, non-numeric, or not positive.
 */
function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/** Window length in milliseconds, from `INDEXER_RATE_LIMIT_WINDOW_MS`. */
export function getRateLimitWindowMs(): number {
  return parsePositiveInteger(
    process.env.INDEXER_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
  );
}

/** Request quota per window, from `INDEXER_RATE_LIMIT_MAX`. */
export function getRateLimitMax(): number {
  return parsePositiveInteger(process.env.INDEXER_RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX);
}

export interface ApiRateLimiterOptions {
  /** Overrides `INDEXER_RATE_LIMIT_WINDOW_MS` when provided. */
  windowMs?: number;
  /** Overrides `INDEXER_RATE_LIMIT_MAX` when provided. */
  limit?: number;
}

/**
 * Builds the per-IP rate limiter for the `/api/v1` router.
 *
 * Defaults to 60 requests per minute per IP and can be tuned with the
 * `INDEXER_RATE_LIMIT_WINDOW_MS` and `INDEXER_RATE_LIMIT_MAX` environment
 * variables. Uses `express-rate-limit`'s in-memory store, which is adequate for
 * a single indexer process; a shared store should be swapped in if the service
 * is ever scaled horizontally.
 *
 * The middleware relies on `req.ip`, so deployments behind a reverse proxy must
 * configure Express' `trust proxy` setting for the client IP to be read from
 * `X-Forwarded-For`.
 */
export function createApiRateLimiter(
  options: ApiRateLimiterOptions = {},
): RateLimitRequestHandler {
  const windowMs = options.windowMs ?? getRateLimitWindowMs();
  const limit = options.limit ?? getRateLimitMax();

  return rateLimit({
    windowMs,
    limit,
    // Emit the standardized `RateLimit`/`RateLimit-Policy` headers, plus the
    // `Retry-After` header the library sends with a 429, and skip the legacy
    // `X-RateLimit-*` headers.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
  });
}
