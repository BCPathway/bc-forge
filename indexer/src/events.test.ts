import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  deliverIndexerEventToWebhooks,
  setWebhookFetchForTests,
  type IndexerEvent,
} from './events';
import { setPrismaClientFactoryForTests } from './lib/prisma';

afterEach(() => {
  setWebhookFetchForTests();
  setPrismaClientFactoryForTests();
});

test('registered webhook receives the same event payload and retries once after failure', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        webhook: {
          findMany: async () => [{ id: 'hook-1', url: 'https://hooks.example.test/events' }],
        },
      }) as never,
  );

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setWebhookFetchForTests(async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: calls.length === 1 ? 503 : 204 });
  });

  const event: IndexerEvent = {
    type: 'mint',
    data: { id: 'mint-1', to: 'GABC', amount: '10', ledger: 123 },
  };

  await deliverIndexerEventToWebhooks(event);

  assert.equal(calls.length, 2, 'one failed delivery should be retried exactly once');
  assert.equal(calls[0]?.url, 'https://hooks.example.test/events');
  assert.equal(calls[1]?.url, 'https://hooks.example.test/events');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(calls[0]?.init?.body, JSON.stringify(event));
  assert.equal(calls[1]?.init?.body, JSON.stringify(event));
});

test('successful webhook delivery is not retried', async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        webhook: {
          findMany: async () => [{ id: 'hook-2', url: 'https://hooks.example.test/ok' }],
        },
      }) as never,
  );

  let calls = 0;
  setWebhookFetchForTests(async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  });

  await deliverIndexerEventToWebhooks({
    type: 'burn',
    data: { id: 'burn-1', from: 'GABC', amount: '2', ledger: 124 },
  });

  assert.equal(calls, 1);
});
