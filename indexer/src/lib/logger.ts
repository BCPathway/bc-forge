/**
 * Minimal structured logger for the indexer.
 *
 * Every call writes exactly one JSON object per line to stdout with
 * `level`, `time`, and `message` fields plus any optional extra fields:
 *
 *   {"level":"info","time":"2026-01-01T00:00:00.000Z","message":"..."}
 *
 * Two layers of secret protection apply:
 *
 * - Fields whose key looks like a credential (`authorization`,
 *   `database_url`, …) are redacted so secrets never reach the logs.
 * - Secrets embedded inside string values — postgres connection strings
 *   and bearer tokens, e.g. inside a database-driver error message or
 *   stack — are scrubbed wherever they appear, including nested objects,
 *   arrays, and `Error` messages/stacks.
 *
 * `level`, `time`, and `message` are reserved: caller-supplied fields can
 * never override them. No third-party log shipper is used — plain JSON to
 * stdout.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const REDACTED = '[redacted]';
const REDACTED_URL = 'postgresql://[redacted]';
const REDACTED_BEARER = 'Bearer [redacted]';

/** Matches `postgres://…` / `postgresql://…` URLs embedded in free text. */
const CONNECTION_STRING_PATTERN = /postgres(?:ql)?:\/\/[^\s"'`\\]+/gi;

/** Matches `Bearer <token>` credentials embedded in free text. */
const BEARER_TOKEN_PATTERN = /Bearer\s+[A-Za-z0-9\-._~+/=]+/gi;

/**
 * Case-insensitive match for keys that must never be logged in cleartext.
 */
function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return (
    normalized.includes('authorization') ||
    normalized.includes('databaseurl') ||
    normalized.includes('secretkey') ||
    normalized.includes('apitoken')
  );
}

/**
 * Scrub secrets embedded inside an arbitrary string value: database
 * connection strings and bearer tokens. Used for every logged string so
 * that e.g. a driver error message cannot smuggle a credential into the
 * logs under an innocent field name.
 */
export function scrubSecretsFromString(value: string): string {
  return value
    .replace(CONNECTION_STRING_PATTERN, REDACTED_URL)
    .replace(BEARER_TOKEN_PATTERN, REDACTED_BEARER);
}

function toLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubSecretsFromString(value.message),
      stack: typeof value.stack === 'string' ? scrubSecretsFromString(value.stack) : value.stack,
    };
  }
  if (typeof value === 'string') {
    return scrubSecretsFromString(value);
  }
  if (Array.isArray(value)) {
    return value.map(toLogValue);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? REDACTED : toLogValue(entry);
    }
    return out;
  }
  return value;
}

/**
 * Redact credential-like keys from a fields object, recursing into nested
 * objects and arrays. Every string value is additionally scrubbed for
 * embedded connection strings and bearer tokens.
 */
export function sanitizeFields(fields: LogFields): LogFields {
  return toLogValue(fields) as LogFields;
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  // Optional fields are spread first so the reserved fields below always
  // win — a caller cannot override level, time, or message.
  const line = JSON.stringify({
    ...sanitizeFields(fields),
    level,
    time: new Date().toISOString(),
    message: scrubSecretsFromString(message),
  });
  process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => log('debug', message, fields),
  info: (message: string, fields?: LogFields): void => log('info', message, fields),
  warn: (message: string, fields?: LogFields): void => log('warn', message, fields),
  error: (message: string, fields?: LogFields): void => log('error', message, fields),
};
