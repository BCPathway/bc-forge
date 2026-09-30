import { deltasFor, fromBigInt, supplyDeltaFor, toBigInt, type LedgerEvent } from './ledger';

/**
 * Minimal data-access surface required to derive and persist ledger
 * aggregates (holder balances and supply points).
 *
 * Prisma model delegates expose much richer signatures; the loose argument
 * types keep this adapter usable from `$transaction(async (tx) => ...)`
 * callbacks without reshaping Prisma's generic types. The call site passes
 * the transaction client, so the event row and its aggregate updates commit
 * or roll back together.
 */
export type AggregateStore = {
  holder: {
    findUnique: (args: any) => Promise<{ balance: string } | null>;
    upsert: (args: {
      where: { address: string };
      update: { balance: string; ledger: number };
      create: { address: string; balance: string; ledger: number };
    }) => Promise<unknown>;
    deleteMany: (args: { where: { address: string } }) => Promise<unknown>;
  };
  supplyPoint: {
    findFirst: (args: any) => Promise<{ supply: string } | null>;
    create: (args: {
      data: { timestamp: Date; supply: string; ledger: number; txHash: string };
    }) => Promise<unknown>;
  };
};

export type ApplyAggregatesOptions = {
  /** Ledger sequence number the event was confirmed in. */
  ledger: number;
  /** Transaction hash of the event. */
  txHash: string;
  /** Ledger close time (falls back to ingestion time). */
  timestamp: Date;
  /**
   * Authoritative `new_supply` from the event payload when the event changes
   * supply (mints and burns). When absent, supply is derived by folding the
   * event's supply delta on top of the latest stored supply point.
   */
  newSupply?: string;
};

/**
 * Apply one indexed event to the persisted aggregates.
 *
 * Holder balances move by the event's signed deltas; a holder whose balance
 * reaches zero is removed so the table only ever lists current holders.
 * Supply-changing events (mint and burn) append a timestamped supply point
 * using the authoritative `new_supply` from the event when available.
 */
export async function applyLedgerEventAggregates(
  store: AggregateStore,
  event: LedgerEvent,
  options: ApplyAggregatesOptions,
): Promise<void> {
  for (const { address, delta } of deltasFor(event)) {
    const current = await store.holder.findUnique({ where: { address } });
    const balance = (current ? toBigInt(current.balance) : 0n) + delta;
    if (balance === 0n) {
      await store.holder.deleteMany({ where: { address } });
      continue;
    }
    const balanceString = fromBigInt(balance);
    await store.holder.upsert({
      where: { address },
      update: { balance: balanceString, ledger: options.ledger },
      create: { address, balance: balanceString, ledger: options.ledger },
    });
  }

  const supplyDelta = supplyDeltaFor(event);
  if (supplyDelta === 0n) {
    return;
  }

  const supply = await resolveSupply(store, supplyDelta, options.newSupply);
  await store.supplyPoint.create({
    data: {
      timestamp: options.timestamp,
      supply,
      ledger: options.ledger,
      txHash: options.txHash,
    },
  });
}

/**
 * Resolve the supply value to persist: the authoritative value from the event
 * payload when present, otherwise the latest stored supply shifted by this
 * event's delta.
 */
async function resolveSupply(
  store: AggregateStore,
  delta: bigint,
  newSupply: string | undefined,
): Promise<string> {
  if (newSupply !== undefined && newSupply.length > 0) {
    return newSupply;
  }

  const latest = await store.supplyPoint.findFirst({
    orderBy: [{ ledger: 'desc' }, { id: 'desc' }],
  });
  return fromBigInt((latest ? toBigInt(latest.supply) : 0n) + delta);
}