import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasContinuousParentChain,
  reconcileLedgerCursor,
  type LedgerCoordinate,
} from './cursor';

function makeFakeDatabase(
  persisted: LedgerCoordinate[],
  rows: Record<string, Array<{ ledger: number }>> = {},
) {
  const deletions: Array<{ model: string; where: unknown }> = [];
  let updatedCursor: unknown;
  const operation = (model: string, where: unknown) => {
    deletions.push({ model, where });
    const ledgerLimit = (where as { ledger: { gt: number } }).ledger.gt;
    const entries = rows[model] ?? [];
    const retained = entries.filter((row) => row.ledger <= ledgerLimit);
    rows[model] = retained;
    return Promise.resolve({ count: entries.length - retained.length });
  };
  const db = {
    indexedLedger: {
      findMany: async () => persisted,
      deleteMany: (args: { where: unknown }) => operation('indexedLedger', args.where),
    },
    mint: { deleteMany: (args: { where: unknown }) => operation('mint', args.where) },
    burn: { deleteMany: (args: { where: unknown }) => operation('burn', args.where) },
    transfer: { deleteMany: (args: { where: unknown }) => operation('transfer', args.where) },
    lastIndexedLedger: {
      upsert: async (args: { update: unknown }) => {
        updatedCursor = args.update;
      },
    },
    $transaction: async (queries: Promise<unknown>[]) => Promise.all(queries),
  };
  return { db, deletions, updatedCursor: () => updatedCursor };
}

function remoteLedger(coordinate: LedgerCoordinate) {
  return {
    sequence: coordinate.ledger,
    hash: coordinate.hash,
    headerXdr: {
      header: () => ({
        previousLedgerHash: () => ({ toString: () => coordinate.parentHash }),
      }),
    },
  };
}

test('reorg reconciliation rewinds to last matching ledger and prunes later rows', async () => {
  const persisted: LedgerCoordinate[] = [
    { ledger: 1, hash: 'hash-1', parentHash: 'genesis' },
    { ledger: 2, hash: 'hash-2', parentHash: 'hash-1' },
    { ledger: 3, hash: 'old-hash-3', parentHash: 'hash-2' },
    { ledger: 4, hash: 'old-hash-4', parentHash: 'old-hash-3' },
  ];
  const rows = {
    mint: [{ ledger: 1 }, { ledger: 3 }, { ledger: 4 }],
    burn: [{ ledger: 2 }, { ledger: 4 }],
    transfer: [{ ledger: 3 }, { ledger: 4 }],
    indexedLedger: persisted.map(({ ledger }) => ({ ledger })),
  };
  const fake = makeFakeDatabase(persisted, rows);
  const rpc = {
    getLedgers: async () => ({
      ledgers: [
        remoteLedger(persisted[0]!),
        remoteLedger(persisted[1]!),
        remoteLedger({ ledger: 3, hash: 'new-hash-3', parentHash: 'hash-2' }),
        remoteLedger({ ledger: 4, hash: 'new-hash-4', parentHash: 'new-hash-3' }),
      ],
    }),
  };

  const rewindTo = await reconcileLedgerCursor(fake.db as never, rpc as never, {
    ledger: 4,
    hash: 'old-hash-4',
    parentHash: 'old-hash-3',
  });

  assert.equal(rewindTo, 2);
  assert.deepEqual(fake.deletions, [
    { model: 'mint', where: { ledger: { gt: 2 } } },
    { model: 'burn', where: { ledger: { gt: 2 } } },
    { model: 'transfer', where: { ledger: { gt: 2 } } },
    { model: 'indexedLedger', where: { ledger: { gt: 2 } } },
  ]);
  assert.deepEqual(fake.updatedCursor(), {
    ledger: 2,
    hash: 'hash-2',
    parentHash: 'hash-1',
  });
  assert.deepEqual(rows, {
    mint: [{ ledger: 1 }],
    burn: [{ ledger: 2 }],
    transfer: [],
    indexedLedger: [{ ledger: 1 }, { ledger: 2 }],
  });
});

test('parent hash mismatch triggers a rewind even when a cursor hash is unchanged', async () => {
  const persisted: LedgerCoordinate[] = [
    { ledger: 1, hash: 'hash-1', parentHash: 'genesis' },
    { ledger: 2, hash: 'hash-2', parentHash: 'old-parent' },
  ];
  const fake = makeFakeDatabase(persisted);
  const rpc = {
    getLedgers: async () => ({
      ledgers: [
        remoteLedger(persisted[0]!),
        remoteLedger({ ledger: 2, hash: 'hash-2', parentHash: 'new-parent' }),
      ],
    }),
  };

  const rewindTo = await reconcileLedgerCursor(fake.db as never, rpc as never, {
    ledger: 2,
    hash: 'hash-2',
    parentHash: 'old-parent',
  });

  assert.equal(rewindTo, 1);
  assert.ok(fake.deletions.some(({ model, where }) =>
    model === 'mint' && JSON.stringify(where) === JSON.stringify({ ledger: { gt: 1 } }),
  ));
});

test('continuous-chain validation rejects sequence gaps and parent hash mismatches', () => {
  const previous = { ledger: 7, hash: 'hash-7', parentHash: 'hash-6' };
  assert.equal(
    hasContinuousParentChain([{ ledger: 8, hash: 'hash-8', parentHash: 'hash-7' }], previous),
    true,
  );
  assert.equal(
    hasContinuousParentChain([{ ledger: 9, hash: 'hash-9', parentHash: 'hash-7' }], previous),
    false,
  );
  assert.equal(
    hasContinuousParentChain([{ ledger: 8, hash: 'hash-8', parentHash: 'fork-parent' }], previous),
    false,
  );
});