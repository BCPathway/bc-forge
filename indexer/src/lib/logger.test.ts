import test from 'node:test';
import assert from 'node:assert/strict';
import { log, logger, sanitizeFields } from './logger';

function captureStdout(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    chunks.push(String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof process.stdout.write;
  return { chunks, restore: () => void (process.stdout.write = originalWrite) };
}

test('log writes one JSON line with level, time, and message', () => {
  const { chunks, restore } = captureStdout();
  try {
    log('info', 'hello', { port: 3000 });
  } finally {
    restore();
  }
  const lines = chunks.flatMap((chunk) => chunk.split('\n')).filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.message, 'hello');
  assert.equal(parsed.port, 3000);
  assert.ok(typeof parsed.time === 'string');
});

test('logger helpers emit their level', () => {
  const { chunks, restore } = captureStdout();
  try {
    logger.error('request failed', { method: 'GET', path: '/api/v1/mints' });
  } finally {
    restore();
  }
  const lines = chunks.flatMap((chunk) => chunk.split('\n')).filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.method, 'GET');
  assert.equal(parsed.path, '/api/v1/mints');
});

test('sanitizeFields redacts authorization and database URLs', () => {
  const sanitized = sanitizeFields({
    authorization: 'Bearer secret',
    nested: { DATABASE_URL: 'postgres://user:pass@host/db' },
    safe: 'visible',
  });
  assert.equal(sanitized.authorization, '[redacted]');
  assert.equal((sanitized.nested as Record<string, unknown>).DATABASE_URL, '[redacted]');
  assert.equal(sanitized.safe, 'visible');
});

test('caller fields cannot override reserved level, time, or message', () => {
  const { chunks, restore } = captureStdout();
  try {
    log('error', 'request failed', {
      level: 'info',
      time: 'invalid',
      message: 'different message',
    });
  } finally {
    restore();
  }
  const lines = chunks.flatMap((chunk) => chunk.split('\n')).filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(parsed.level, 'error');
  assert.equal(parsed.message, 'request failed');
  assert.notEqual(parsed.time, 'invalid');
  assert.ok(typeof parsed.time === 'string');
});

test('secrets embedded in error message strings are scrubbed', () => {
  const bearer = 'Bearer test-indexer-api-token';
  const url = 'postgresql://user:s3cret@db-host:5432/indexer';
  const { chunks, restore } = captureStdout();
  try {
    logger.error('request failed', {
      error: `connection failed: ${url} while using ${bearer}`,
    });
  } finally {
    restore();
  }
  const lines = chunks.flatMap((chunk) => chunk.split('\n')).filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  const serialized = lines[0];
  assert.ok(!serialized.includes('s3cret'), 'connection string must not appear');
  assert.ok(!serialized.includes('test-indexer-api-token'), 'bearer token must not appear');
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  assert.ok(String(parsed.error).includes('postgresql://[redacted]'));
  assert.ok(String(parsed.error).includes('Bearer [redacted]'));
});

test('postgres:// URLs are scrubbed too', () => {
  const sanitized = sanitizeFields({
    error: 'driver: postgres://admin:pw@10.0.0.1/db?sslmode=require failed',
  });
  assert.ok(!String(sanitized.error).includes('pw@10.0.0.1'));
  assert.ok(String(sanitized.error).includes('postgresql://[redacted]'));
});

test('nested objects and arrays containing secrets are scrubbed', () => {
  const sanitized = sanitizeFields({
    nested: {
      detail: 'using Bearer nested-token-123 for upstream',
      list: ['plain', 'db postgresql://u:p@h/d end'],
    },
    safe: 'nothing sensitive here',
  });
  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes('nested-token-123'));
  assert.ok(!serialized.includes('u:p@h'));
  assert.equal(sanitized.safe, 'nothing sensitive here');
  const nested = sanitized.nested as Record<string, unknown>;
  assert.ok(String(nested.detail).includes('Bearer [redacted]'));
  assert.ok(String((nested.list as unknown[])[1]).includes('postgresql://[redacted]'));
});

test('Error objects have scrubbed messages and stacks', () => {
  const err = new Error('query failed: postgresql://user:pw@host/db with Bearer abc-123');
  err.stack = `Error: query failed\n    at postgresql://user:pw@host/db (Bearer abc-123)`;
  const sanitized = sanitizeFields({ error: err });
  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes('pw@host'));
  assert.ok(!serialized.includes('abc-123'));
  const logged = sanitized.error as Record<string, unknown>;
  assert.equal(logged.name, 'Error');
  assert.ok(String(logged.message).includes('postgresql://[redacted]'));
  assert.ok(String(logged.stack).includes('Bearer [redacted]'));
});
