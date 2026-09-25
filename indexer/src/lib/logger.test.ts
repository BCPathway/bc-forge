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
