import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLedgerEventAggregates, type AggregateStore } from './aggregates';
import type { LedgerEvent } from './ledger';

type SupplyPointRecord = {
  timestamp: Date;
  supply: string;
  ledger: number;
  txHash: string;
};

/**
 * In-memory fake of the aggregate store that mirrors how Prisma persists rows:
 * `findUnique` reads what a prior `upsert`/`deleteMany` wrote, so sequences of
 * events exercise the real read-modify-write loop. Every call is recorded in
 * `ops` for exact order assertions.
 */
function createFakeStore(seed: Record<string, string> = {}) {
  const balances = new Map<string, string>(Object.entries(seed));
  const supplyPoints: SupplyPointRecord[] = [];
  const ops: string[] = [];

  const store: AggregateStore = {
    holder: {
      findUnique: async ({ where }) => {
        ops.push(`find:${where.address}`);
        const balance = balances.get(where.address);
        return balance === undefined ? null : { balance };
      },
      upsert: async ({ where, update }) => {
        ops.push(`upsert:${where.address}:${update.balance}`);
        balances.set(where.address, update.balance);
        return {};
      },
      deleteMany: async ({ where }) => {
        ops.push(`delete:${where.address}`);
        balances.delete(where.address);
        return { count: 1 };
      },
    },
    supplyPoint: {
      findFirst: async () => {
        ops.push('latestSupply');
        const latest = supplyPoints[supplyPoints.length - 1];
        return latest ? { supply: latest.supply } : null;
      },
      create: async ({ data }) => {
        ops.push(`point:${data.supply}:${data.ledger}:${data.txHash}`);
        supplyPoints.push(data);
        return {};
      },
    },
  };

  return { store, balances, supplyPoints, ops };
}

const t = new Date('2026-01-15T12:00:00.000Z');

test('a mint then a transfer then a burn updates holder balances and supply', async () => {
  const { store, balances, supplyPoints, ops } = createFakeStore();

  await applyLedgerEventAggregates(store, { type: 'mint', to: 'GABC', amount: '1000' }, {
    ledger: 10,
    txHash: 't1',
    timestamp: t,
    newSupply: '1000',
  });

  assert.equal(balances.get('GABC'), '1000');
  assert.deepEqual(supplyPoints.map((p) => ({ supply: p.supply, ledger: p.ledger, txHash: p.txHash, timestamp: p.timestamp })), [
    { supply: '1000', ledger: 10, txHash: 't1', timestamp: t },
  ]);

  await applyLedgerEventAggregates(
    store,
    { type: 'transfer', from: 'GABC', to: 'GDEF', amount: '400' },
    { ledger: 11, txHash: 't2', timestamp: t },
  );

  assert.equal(balances.get('GABC'), '600');
  assert.equal(balances.get('GDEF'), '400');
  assert.equal(supplyPoints.length, 1, 'transfers must not add supply points');

  await applyLedgerEventAggregates(store, { type: 'burn', from: 'GDEF', amount: '400' }, {
    ledger: 12,
    txHash: 't3',
    timestamp: t,
    newSupply: '600',
  });

  assert.equal(balances.has('GDEF'), false, 'zero-balance holder must be removed');
  assert.equal(balances.get('GABC'), '600');
  assert.deepEqual(
    supplyPoints.map((p) => p.supply),
    ['1000', '600'],
  );
  assert.deepEqual(ops, [
    'find:GABC',
    'upsert:GABC:1000',
    'point:1000:10:t1',
    'find:GABC',
    'upsert:GABC:600',
    'find:GDEF',
    'upsert:GDEF:400',
    'find:GDEF',
    'delete:GDEF',
    'point:600:12:t3',
  ]);
});

test('a second mint to the same holder accumulates the balance', async () => {
  const { store, balances, supplyPoints } = createFakeStore({ GABC: '500' });

  await applyLedgerEventAggregates(store, { type: 'mint', to: 'GABC', amount: '500' }, {
    ledger: 20,
    txHash: 'm2',
    timestamp: t,
    newSupply: '1000',
  });

  assert.equal(balances.get('GABC'), '1000');
  assert.deepEqual(
    supplyPoints.map((p) => p.supply),
    ['1000'],
  );
});

test('supply is derived from the latest point when the event omits newSupply', async () => {
  const { store, supplyPoints } = createFakeStore();

  await applyLedgerEventAggregates(store, { type: 'mint', to: 'GABC', amount: '1000' }, {
    ledger: 30,
    txHash: 'm-d1',
    timestamp: t,
  });

  assert.deepEqual(
    supplyPoints.map((p) => p.supply),
    ['1000'],
  );

  await applyLedgerEventAggregates(store, { type: 'burn', from: 'GABC', amount: '400' }, {
    ledger: 31,
    txHash: 'b-d1',
    timestamp: t,
  });

  assert.deepEqual(
    supplyPoints.map((p) => p.supply),
    ['1000', '600'],
    'the burn should fold the delta on top of the latest recorded supply',
  );
});

test('holder balances track exact amounts beyond Number.MAX_SAFE_INTEGER', async () => {
  const huge = '1000000000000000000000000000000000';
  const { store, balances } = createFakeStore();

  await applyLedgerEventAggregates(store, { type: 'mint', to: 'GABC', amount: huge }, {
    ledger: 40,
    txHash: 'huge',
    timestamp: t,
    newSupply: huge,
  });

  assert.equal(balances.get('GABC'), huge);
});