import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { setPrismaClientFactoryForTests } from './lib/prisma';

process.env.CONTRACT_ID ??= 'CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5';

let processEvent: typeof import('./indexer').processEvent;

before(async () => {
  ({ processEvent } = await import('./indexer'));
});

after(() => {
  setPrismaClientFactoryForTests();
  delete process.env.CONTRACT_ID;
});

test('replaying an event after rewind does not duplicate its unique txHash row', async () => {
  const rows = new Map<string, Record<string, unknown>>();
  const database = {
    webhook: { findMany: async () => [] },
    mint: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const txHash = data.txHash as string;
        if (rows.has(txHash)) {
          const error = new Error('unique constraint') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        rows.set(txHash, data);
        return data;
      },
    },
  };
  setPrismaClientFactoryForTests(() => database as never);
  const event = {
    topic: [nativeToScVal('mint', { type: 'symbol' })],
    value: nativeToScVal(['GADMIN', 'GRECIPIENT', '10']),
    ledger: 12,
    txHash: 'fork-replay-tx',
  } as never;

  await processEvent(event, database as never);
  await processEvent(event, database as never);

  assert.equal(rows.size, 1);
  assert.deepEqual(rows.get('fork-replay-tx'), {
    to: 'GRECIPIENT',
    amount: '10',
    ledger: 12,
    txHash: 'fork-replay-tx',
  });
});