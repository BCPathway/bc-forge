import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import apiRouter from './api';
import { setPrismaClientFactoryForTests } from './lib/prisma';

const API_TOKEN = 'test-indexer-api-token';

const mintRows = [{ id: 1, to: 'GABC', amount: '100' }];
const transferRows = [{ id: 2, from: 'GABC', to: 'GDEF', amount: '50' }];
const burnRows = [{ id: 3, from: 'GDEF', amount: '25' }];

// Stub Prisma the same way lib/prisma.test.ts does, so the read routes resolve
// against in-memory rows instead of a real database.
setPrismaClientFactoryForTests(
  () =>
    ({
      mint: { findMany: async () => mintRows, count: async () => mintRows.length },
      transfer: { findMany: async () => transferRows, count: async () => transferRows.length },
      burn: { findMany: async () => burnRows, count: async () => burnRows.length },
    }) as never,
);

process.env.INDEXER_API_TOKEN = API_TOKEN;

const readRoutes = ['/api/v1/mints', '/api/v1/transfers', '/api/v1/burns', '/api/v1/stats'];

async function withServer<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use('/api/v1', apiRouter);

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

test('read routes return 401 without a bearer token', async () => {
  await withServer(async (baseUrl) => {
    for (const route of readRoutes) {
      const res = await fetch(`${baseUrl}${route}`);
      assert.equal(res.status, 401, `${route} should require authentication`);
      assert.deepEqual(await res.json(), { error: 'Unauthorized' });
    }
  });
});

test('read routes return 401 with an invalid bearer token', async () => {
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/v1/mints`, {
      headers: { authorization: 'Bearer not-the-configured-token' },
    });
    assert.equal(res.status, 401);
  });
});

test('read routes return handler JSON with the configured bearer token', async () => {
  await withServer(async (baseUrl) => {
    const headers = { authorization: `Bearer ${API_TOKEN}` };

    const mints = await fetch(`${baseUrl}/api/v1/mints`, { headers });
    assert.equal(mints.status, 200);
    assert.deepEqual(await mints.json(), mintRows);

    const transfers = await fetch(`${baseUrl}/api/v1/transfers`, { headers });
    assert.equal(transfers.status, 200);
    assert.deepEqual(await transfers.json(), transferRows);

    const burns = await fetch(`${baseUrl}/api/v1/burns`, { headers });
    assert.equal(burns.status, 200);
    assert.deepEqual(await burns.json(), burnRows);

    const stats = await fetch(`${baseUrl}/api/v1/stats`, { headers });
    assert.equal(stats.status, 200);
    assert.deepEqual(await stats.json(), {
      mintCount: mintRows.length,
      transferCount: transferRows.length,
      burnCount: burnRows.length,
    });
  });
});

after(() => {
  setPrismaClientFactoryForTests();
  delete process.env.INDEXER_API_TOKEN;
});
