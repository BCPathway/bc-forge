/**
 * Minimal structured logger for the indexer.
 *
 * Every call writes exactly one JSON object per line to stdout with
 * `level`, `time`, and `message` fields plus any optional extra fields:
 *
 *   {"level":"info","time":"2026-01-01T00:00:00.000Z","message":"..."}
 *
 * Fields whose key looks like a credential (`authorization`,
 * `database_url`, …) are redacted so secrets never reach the logs.
 * No third-party log shipper is used — plain JSON to stdout.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

const REDACTED = '[redacted]';

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

function toLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
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
 * Redact credential-like keys from a fields object (shallow scan that
 * recurses into nested objects and arrays).
 */
export function sanitizeFields(fields: LogFields): LogFields {
  return toLogValue(fields) as LogFields;
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...sanitizeFields(fields),
  });
  process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: LogFields): void => log('debug', message, fields),
  info: (message: string, fields?: LogFields): void => log('info', message, fields),
  warn: (message: string, fields?: LogFields): void => log('warn', message, fields),
  error: (message: string, fields?: LogFields): void => log('error', message, fields),
};
