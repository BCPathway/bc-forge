import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { versionHandler } from './version';

/**
 * Build an express app with the same shape as index.ts: the /version route
 * registered outside any authenticated router, followed by a JSON 404 handler.
 */
function createApp(): express.Express {
  const app = express();
  app.get('/version', (req, res) => {
    versionHandler(req, res);
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

/** Fixed build values standing in for what the Dockerfile bakes in. */
const FIXED_BUILD = {
  BUILD_NAME: 'bc-forge-indexer',
  BUILD_VERSION: '1.2.3',
  BUILD_REVISION: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  BUILD_DATE: '2026-01-02T03:04:05Z',
  BUILD_SOURCE: 'https://github.com/BCPathway/bc-forge',
};

/** Env vars the indexer holds that must never appear in the response. */
const SECRETS = {
  DATABASE_URL: 'postgresql://indexer:hunter2@db.internal:5432/bcforge',
  INDEXER_API_TOKEN: 'super-secret-api-token',
};

function setBuildEnv(build: Record<string, string | undefined>, secrets: Record<string, string> = {}) {
  for (const key of [...Object.keys(FIXED_BUILD), ...Object.keys(SECRETS)]) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(build)) {
    if (value !== undefined) process.env[key] = value;
  }
  for (const [key, value] of Object.entries(secrets)) {
    process.env[key] = value;
  }
}

test('/version reports the version and revision baked into the image', async () => {
  setBuildEnv(FIXED_BUILD);

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/version`, { method: 'GET' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true);
    assert.deepEqual(await res.json(), {
      name: 'bc-forge-indexer',
      version: '1.2.3',
      revision: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      buildDate: '2026-01-02T03:04:05Z',
      source: 'https://github.com/BCPathway/bc-forge',
    });
  });
});

test('/version stays unauthenticated and outside the /api/v1 router', async () => {
  setBuildEnv(FIXED_BUILD);

  process.env.INDEXER_API_TOKEN = 'some-other-token';
  const apiRouter = (await import('./api')).default;
  const app = express();
  app.use('/api/v1', apiRouter);
  app.get('/version', (req, res) => {
    versionHandler(req, res);
  });

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    // No Authorization header is sent: the endpoint must stay unauthenticated.
    const res = await fetch(`http://127.0.0.1:${port}/version`, { method: 'GET' });
    assert.equal(res.status, 200, '/version must not require the API token');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.version, '1.2.3');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    delete process.env.INDEXER_API_TOKEN;
  }
});

test('/version never leaks unrelated environment values such as secrets', async () => {
  setBuildEnv(FIXED_BUILD, SECRETS);

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/version`, { method: 'GET' });
    assert.equal(res.status, 200);
    const raw = await res.text();
    assert.ok(!raw.includes('hunter2'), 'response must not contain the database password');
    assert.ok(!raw.includes('postgresql://'), 'response must not contain the database URL');
    assert.ok(!raw.includes('super-secret-api-token'), 'response must not contain the API token');
    assert.deepEqual(Object.keys(JSON.parse(raw) as Record<string, unknown>).sort(), [
      'buildDate',
      'name',
      'revision',
      'source',
      'version',
    ]);
  });
});

test('/version falls back to unknown when build arguments are absent', async () => {
  setBuildEnv({});

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/version`, { method: 'GET' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      name: 'bc-forge-indexer',
      version: 'unknown',
      revision: 'unknown',
      buildDate: 'unknown',
      source: 'https://github.com/BCPathway/bc-forge',
    });
  });
});

test('/version treats blank build arguments as unset', async () => {
  setBuildEnv({ ...FIXED_BUILD, BUILD_VERSION: '   ', BUILD_REVISION: '' });

  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/version`, { method: 'GET' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.version, 'unknown');
    assert.equal(body.revision, 'unknown');
    // Untouched keys keep their fixed values.
    assert.equal(body.buildDate, '2026-01-02T03:04:05Z');
  });
});

after(() => {
  setBuildEnv({});
  delete process.env.INDEXER_API_TOKEN;
});
