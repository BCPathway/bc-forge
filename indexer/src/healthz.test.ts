import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { healthzHandler } from './healthz';
import { setPrismaClientFactoryForTests } from './lib/prisma';
import { resetMetricsForTests, setLatestNetworkLedger } from './metrics';

test('GET /healthz reports the latest indexed cursor and network lag', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        lastIndexedLedger: {
          findUnique: async () => ({ id: 1, ledger: 420 }),
        },
      }) as never,
  );
  setLatestNetworkLedger(437);

  const app = express();
  app.get('/healthz', (req, res) => {
    void healthzHandler(req, res);
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      lastIndexedLedger: 420,
      latestNetworkLedger: 437,
      lag: 17,
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
});

after(() => {
  setPrismaClientFactoryForTests();
  resetMetricsForTests();
});