import test from 'node:test';
import assert from 'node:assert/strict';
import { logFatalIndexerError, logShutdown, logStartup } from './lifecycle';

function captureLogLines(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    chunks.push(String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof process.stdout.write;
  return { chunks, restore: () => void (process.stdout.write = originalWrite) };
}

/**
 * Structured log records only: node --test TAP progress (and any harness
 * framing bytes) share stdout, so ignore lines that are not log-shaped.
 */
function logRecords(chunks: string[]): Array<Record<string, unknown>> {
  return chunks
    .flatMap((chunk) => chunk.split('\n'))
    .filter((line) => line.startsWith('{'))
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        return typeof parsed.level === 'string' && typeof parsed.message === 'string'
          ? [parsed]
          : [];
      } catch {
        return [];
      }
    });
}

test('logStartup emits one JSON line with the port', () => {
  const { chunks, restore } = captureLogLines();
  try {
    logStartup(3000);
  } finally {
    restore();
  }
  const records = logRecords(chunks);
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 'info');
  assert.equal(records[0].message, 'indexer microservice API listening');
  assert.equal(records[0].port, 3000);
  assert.ok(typeof records[0].time === 'string');
});

test('logShutdown emits one JSON line with the signal', () => {
  const { chunks, restore } = captureLogLines();
  try {
    logShutdown('SIGTERM');
  } finally {
    restore();
  }
  const records = logRecords(chunks);
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 'info');
  assert.equal(records[0].message, 'shutting down, disconnecting Prisma client');
  assert.equal(records[0].signal, 'SIGTERM');
});

test('logFatalIndexerError emits one JSON line and scrubs secrets', () => {
  const { chunks, restore } = captureLogLines();
  try {
    logFatalIndexerError(
      new Error(
        'connection failed: postgresql://user:pw@host/db with Bearer fatal-token-1',
      ),
    );
  } finally {
    restore();
  }
  const records = logRecords(chunks);
  assert.equal(records.length, 1);
  assert.equal(records[0].level, 'error');
  assert.equal(records[0].message, 'fatal indexer error');
  const serialized = JSON.stringify(records[0]);
  assert.ok(!serialized.includes('pw@host'));
  assert.ok(!serialized.includes('fatal-token-1'));
});

test('logFatalIndexerError handles non-Error values', () => {
  const { chunks, restore } = captureLogLines();
  try {
    logFatalIndexerError('plain string failure');
  } finally {
    restore();
  }
  const records = logRecords(chunks);
  assert.equal(records.length, 1);
  assert.equal(records[0].error, 'plain string failure');
});
