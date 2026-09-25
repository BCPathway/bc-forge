import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { healthHandler } from './health';
import { setPrismaClientFactoryForTests } from './lib/prisma';

/**
 * Build an express app with the same shape as index.ts: the /health route
 * registered outside any authenticated router, followed by the shared JSON
 * error handler.
 */
function createApp(): express.Express {
  const app = express();
  app.get('/health', (req, res) => {
    void healthHandler(req, res);
  });
  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  return app;
}

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

/** Capture structured log lines on stdout (node --test shares the stream). */
function captureLogLines(): { lines: () => string[]; restore: () => void } {
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...args: unknown[]) => {
    chunks.push(String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...args);
  }) as typeof process.stdout.write;

  return {
    lines: () =>
      chunks
        .flatMap((chunk) => chunk.split('\n'))
        .filter((line) => {
          if (!line.startsWith('{')) {
            return false;
          }
          try {
            const parsed = JSON.parse(line) as Record<string, unknown>;
            return typeof parsed.level === 'string' && typeof parsed.message === 'string';
          } catch {
            return false;
          }
        }),
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

test('/health returns 200 { status: ok } after a successful database ping', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        $queryRaw: async () => [{ '?column?': 1 }],
      }) as never,
  );

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  });
});

test('/health returns 503 { status: error } when the database ping throws', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        $queryRaw: async () => {
          throw new Error(
            "error: password authentication failed ... connection URL: postgresql://user:pw@host:5432/db",
          );
        },
      }) as never,
  );

  const captured = captureLogLines();
  try {
    await withServer(async (baseUrl) => {
      // No Authorization header is sent: the probe must stay unauthenticated.
      const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
      assert.equal(res.status, 503);
      const body = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(body, { status: 'error' });
      assert.ok(
        !JSON.stringify(body).includes('postgresql://'),
        'response body must not contain connection strings',
      );
      assert.ok(
        !JSON.stringify(body).includes('password authentication failed'),
        'response body must not contain driver error text',
      );
    });
  } finally {
    captured.restore();
  }

  const lines = captured.lines();
  assert.equal(lines.length, 1, 'health failure should log exactly one JSON line');
  const logged = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(logged.level, 'error');
  assert.equal(logged.message, 'health check failed');
  assert.ok(typeof logged.time === 'string');
  // The logger scrubs embedded connection strings before writing.
  assert.ok(
    !JSON.stringify(logged).includes('postgresql://user:pw@host'),
    'connection string must not be logged in cleartext',
  );
});

test('/health returns 503 for a non-Error rejection', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        $queryRaw: async () => {
          throw 'connection failed: postgresql://user:pw@host/db';
        },
      }) as never,
  );

  const captured = captureLogLines();
  try {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`, { method: 'GET' });
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { status: 'error' });
    });
  } finally {
    captured.restore();
  }

  const lines = captured.lines();
  assert.equal(lines.length, 1, 'non-Error failure should log exactly one JSON line');
  assert.ok(!lines[0].includes('pw@host'), 'connection string must not be logged');
});

test('/health stays unauthenticated and outside the /api/v1 router', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        $queryRaw: async () => [{ '?column?': 1 }],
      }) as never,
  );

  process.env.INDEXER_API_TOKEN = 'some-other-token';
  const apiRouter = (await import('./api')).default;
  const app = express();
  app.use('/api/v1', apiRouter);
  app.get('/health', (req, res) => {
    void healthHandler(req, res);
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { method: 'GET' });
    assert.equal(res.status, 200, '/health must not require the API token');
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    delete process.env.INDEXER_API_TOKEN;
  }
});

after(() => {
  setPrismaClientFactoryForTests();
  delete process.env.INDEXER_API_TOKEN;
});
