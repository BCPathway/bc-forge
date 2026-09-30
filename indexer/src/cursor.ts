import type { PrismaClient, IndexedLedger } from '@prisma/client';
import type { rpc as SorobanRpc } from '@stellar/stellar-sdk';

export const REORG_LOOKBACK_LEDGERS = 1000;

export interface LedgerCoordinate {
  ledger: number;
  hash: string;
  parentHash: string;
}

type LedgerRpc = Pick<SorobanRpc.Server, 'getLedgers'>;

export function toLedgerCoordinate(ledger: SorobanRpc.Api.LedgerResponse): LedgerCoordinate {
  return {
    ledger: ledger.sequence,
    hash: ledger.hash,
    parentHash: ledger.headerXdr.header().previousLedgerHash().toString('hex'),
  };
}

export function hasContinuousParentChain(
  ledgers: LedgerCoordinate[],
  previous?: LedgerCoordinate | null,
): boolean {
  let parent = previous ?? null;
  for (const ledger of ledgers) {
    if (parent && (ledger.ledger !== parent.ledger + 1 || ledger.parentHash !== parent.hash)) {
      return false;
    }
    parent = ledger;
  }
  return true;
}

export async function seedLedgerCheckpoints(
  prisma: PrismaClient,
  rpc: LedgerRpc,
  cursor: { ledger: number; hash: string | null },
): Promise<void> {
  if (cursor.ledger <= 0 || cursor.hash) return;

  const startLedger = Math.max(1, cursor.ledger - REORG_LOOKBACK_LEDGERS + 1);
  const response = await rpc.getLedgers({
    startLedger,
    pagination: { limit: REORG_LOOKBACK_LEDGERS },
  });
  const coordinates = response.ledgers
    .filter((ledger) => ledger.sequence <= cursor.ledger)
    .map(toLedgerCoordinate);
  const cursorCoordinate = coordinates.find((coordinate) => coordinate.ledger === cursor.ledger);
  if (!cursorCoordinate) return;

  await prisma.$transaction([
    prisma.indexedLedger.createMany({ data: coordinates, skipDuplicates: true }),
    prisma.lastIndexedLedger.update({
      where: { id: 1 },
      data: { hash: cursorCoordinate.hash, parentHash: cursorCoordinate.parentHash },
    }),
  ]);
}

/** Compare persisted coordinates with RPC and roll back to their last common ledger. */
export async function reconcileLedgerCursor(
  prisma: PrismaClient,
  rpc: LedgerRpc,
  cursor: { ledger: number; hash: string | null; parentHash: string | null },
): Promise<number> {
  if (cursor.ledger <= 0) return cursor.ledger;

  const scanStart = Math.max(1, cursor.ledger - REORG_LOOKBACK_LEDGERS + 1);
  const [persisted, remote] = await Promise.all([
    prisma.indexedLedger.findMany({
      where: { ledger: { gte: scanStart, lte: cursor.ledger } },
      orderBy: { ledger: 'asc' },
    }),
    rpc.getLedgers({ startLedger: scanStart, pagination: { limit: REORG_LOOKBACK_LEDGERS } }),
  ]);
  const remoteBySequence = new Map(remote.ledgers.map((ledger) => [ledger.sequence, ledger]));

  let commonCheckpoint: IndexedLedger | LedgerCoordinate | null = null;
  let mismatchFound = false;
  for (const checkpoint of persisted) {
    const current = remoteBySequence.get(checkpoint.ledger);
    const remoteCoordinate = current ? toLedgerCoordinate(current) : null;
    if (
      !remoteCoordinate ||
      remoteCoordinate.hash !== checkpoint.hash ||
      remoteCoordinate.parentHash !== checkpoint.parentHash
    ) {
      mismatchFound = true;
      break;
    }
    commonCheckpoint = checkpoint;
  }

  if (persisted.length && persisted[persisted.length - 1]?.ledger !== cursor.ledger) {
    const currentCursor = remoteBySequence.get(cursor.ledger);
    const remoteCoordinate = currentCursor ? toLedgerCoordinate(currentCursor) : null;
    if (
      cursor.hash &&
      (!remoteCoordinate ||
        remoteCoordinate.hash !== cursor.hash ||
        (cursor.parentHash !== null && remoteCoordinate.parentHash !== cursor.parentHash))
    ) {
      mismatchFound = true;
    }
  }

  if (!persisted.length && cursor.hash) {
    const currentCursor = remoteBySequence.get(cursor.ledger);
    const remoteCoordinate = currentCursor ? toLedgerCoordinate(currentCursor) : null;
    if (
      !remoteCoordinate ||
      remoteCoordinate.hash !== cursor.hash ||
      (cursor.parentHash !== null && remoteCoordinate.parentHash !== cursor.parentHash)
    ) {
      mismatchFound = true;
      const previous = remoteBySequence.get(cursor.ledger - 1);
      if (previous?.hash === cursor.parentHash) {
        commonCheckpoint = toLedgerCoordinate(previous);
      }
    }
  }

  if (!mismatchFound) return cursor.ledger;

  const rewindLedger = commonCheckpoint?.ledger ?? 0;
  const update = commonCheckpoint
    ? { ledger: rewindLedger, hash: commonCheckpoint.hash, parentHash: commonCheckpoint.parentHash }
    : { ledger: rewindLedger, hash: null, parentHash: null };

  await prisma.$transaction([
    prisma.mint.deleteMany({ where: { ledger: { gt: rewindLedger } } }),
    prisma.burn.deleteMany({ where: { ledger: { gt: rewindLedger } } }),
    prisma.transfer.deleteMany({ where: { ledger: { gt: rewindLedger } } }),
    prisma.indexedLedger.deleteMany({ where: { ledger: { gt: rewindLedger } } }),
    prisma.lastIndexedLedger.upsert({
      where: { id: 1 },
      update,
      create: { id: 1, ...update },
    }),
  ]);

  return rewindLedger;
}