import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { nativeToScVal } from '@stellar/stellar-sdk';
import { createApiRouter } from './api';
import { setPrismaClientFactoryForTests } from './lib/prisma';

process.env.CONTRACT_ID ??= 'CCJZ5DGASBWQXR5MPFCJXMBI333XE5U3FSJTNQU7RIKE3P5GN2K2WYD5';
process.env.INDEXER_API_TOKEN ??= 'test-indexer-api-token';

let processEvent: typeof import('./indexer').processEvent;

before(async () => {
  ({ processEvent } = await import('./indexer'));
});

after(() => {
  setPrismaClientFactoryForTests();
});

type Row = Record<string, unknown> & { txHash?: string };

/**
 * In-memory stand-in for the Prisma delegates these events write.
 * A second insert with the same txHash raises P2002, matching the unique index.
 */
function memoryDatabase() {
  const tables = new Map<string, Map<string, Row>>();

  const delegate = (name: string) => ({
    create: async ({ data }: { data: Row }) => {
      const rows = tables.get(name) ?? new Map<string, Row>();
      const txHash = data.txHash as string;
      if (rows.has(txHash)) {
        const error = new Error('unique constraint') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      rows.set(txHash, data);
      tables.set(name, rows);
      return data;
    },
    findMany: async () => [...(tables.get(name)?.values() ?? [])],
  });

  return {
    tables,
    webhook: { findMany: async () => [] },
    vaultDeposit: delegate('vaultDeposit'),
    wrapperUpdate: delegate('wrapperUpdate'),
    vestingClaim: delegate('vestingClaim'),
    splitDistribution: delegate('splitDistribution'),
  };
}

function contractEvent(topic: string, value: unknown[], txHash: string) {
  return {
    topic: [nativeToScVal(topic, { type: 'symbol' })],
    value: nativeToScVal(value),
    ledger: 42,
    txHash,
  } as never;
}

test('decodes vault, wrapper, vesting, and split events and keeps txHash unique', async () => {
  const database = memoryDatabase();
  setPrismaClientFactoryForTests(() => database as never);

  await processEvent(
    contractEvent('deposit', ['GCALLER', '1000', '900', 1], 'deposit-tx'),
    database as never,
  );
  await processEvent(
    contractEvent('deposit', ['GCALLER', '1000', '900'], 'deposit-tx'),
    database as never,
  );
  await processEvent(
    contractEvent('wrap', ['GWRAPPER', '50', '50'], 'wrap-tx'),
    database as never,
  );
  await processEvent(
    contractEvent('unwrap', ['GWRAPPER', '20', '19'], 'unwrap-tx'),
    database as never,
  );
  await processEvent(
    contractEvent('v_rel', ['GBENEFICIARY', '15'], 'claim-tx'),
    database as never,
  );
  await processEvent(
    contractEvent('pyo_succ', ['7', 'GRECIPIENT', '15'], 'payout-tx'),
    database as never,
  );
  await processEvent(
    contractEvent('pyo_succ', ['7', 'GRECIPIENT', '15'], 'payout-tx'),
    database as never,
  );

  assert.equal(database.tables.get('vaultDeposit')?.size, 1);
  assert.deepEqual(database.tables.get('vaultDeposit')?.get('deposit-tx'), {
    caller: 'GCALLER',
    assets: '1000',
    shares: '900',
    ledger: 42,
    txHash: 'deposit-tx',
  });
  assert.deepEqual(database.tables.get('wrapperUpdate')?.get('wrap-tx'), {
    kind: 'wrap',
    caller: 'GWRAPPER',
    amount: '50',
    resultAmount: '50',
    ledger: 42,
    txHash: 'wrap-tx',
  });
  assert.deepEqual(database.tables.get('wrapperUpdate')?.get('unwrap-tx'), {
    kind: 'unwrap',
    caller: 'GWRAPPER',
    amount: '20',
    resultAmount: '19',
    ledger: 42,
    txHash: 'unwrap-tx',
  });
  assert.deepEqual(database.tables.get('vestingClaim')?.get('claim-tx'), {
    beneficiary: 'GBENEFICIARY',
    amount: '15',
    ledger: 42,
    txHash: 'claim-tx',
  });
  assert.equal(database.tables.get('splitDistribution')?.size, 1);
  assert.deepEqual(database.tables.get('splitDistribution')?.get('payout-tx'), {
    invoiceId: '7',
    recipient: 'GRECIPIENT',
    amount: '15',
    ledger: 42,
    txHash: 'payout-tx',
  });
});

test('does not invent a rate-limit row when no contract topic is emitted', async () => {
  const database = memoryDatabase();
  setPrismaClientFactoryForTests(() => database as never);

  await processEvent(contractEvent('rate_limit', ['GADDR', 'mint', '1'], 'rl-tx'), database as never);

  assert.equal(database.tables.size, 0);
});

test('lists the new event families beside /mints', async () => {
  const database = memoryDatabase();
  database.tables.set(
    'vaultDeposit',
    new Map([
      [
        'deposit-tx',
        {
          id: 'vd-1',
          caller: 'GCALLER',
          assets: '1000',
          shares: '900',
          ledger: 42,
          txHash: 'deposit-tx',
          createdAt: new Date('2026-09-30T00:00:00.000Z'),
        },
      ],
    ]),
  );
  setPrismaClientFactoryForTests(() => database as never);

  const app = express();
  app.use('/api/v1', createApiRouter());
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/vault-deposits`, {
      headers: { authorization: `Bearer ${process.env.INDEXER_API_TOKEN}` },
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: Array<{ txHash: string }> };
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0]?.txHash, 'deposit-tx');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
