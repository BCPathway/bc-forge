import { rpc as SorobanRpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { publishIndexerEvent } from './events';
import { applyLedgerEventAggregates, type AggregateStore } from './aggregates';
import type { LedgerEvent } from './ledger';
import { logger } from './lib/logger';
import { setLatestNetworkLedger } from './metrics';

dotenv.config();

const prisma = new PrismaClient();

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.CONTRACT_ID;
const LAG_THRESHOLD = Number.parseInt(process.env.INDEXER_LAG_THRESHOLD || '100', 10);

if (!CONTRACT_ID) {
  throw new Error('CONTRACT_ID environment variable is required');
}

const server = new SorobanRpc.Server(RPC_URL);

/**
 * Main indexer loop to fetch and process Soroban events.
 */
export async function runIndexer() {
  logger.info('starting contract indexer', { contractId: CONTRACT_ID });

  // 1. Get the last indexed ledger
  let lastLedger = await prisma.lastIndexedLedger.findUnique({ where: { id: 1 } });
  if (lastLedger) {
    await seedLedgerCheckpoints(prisma, server, lastLedger);
  }
  let startLedger = lastLedger ? lastLedger.ledger + 1 : 1;

  // 2. Continuous loop
  while (true) {
    try {
      const currentLedger = (await server.getLatestLedger()).sequence;

      setLatestNetworkLedger(currentLedger);
      const lag = Math.max(0, currentLedger - (startLedger - 1));
      if (lag > LAG_THRESHOLD) {
        logger.warn('indexer lag threshold exceeded', {
          alert: 'indexer_lag_threshold_exceeded',
          lastIndexedLedger: startLedger - 1,
          latestNetworkLedger: currentLedger,
          lag,
          threshold: LAG_THRESHOLD,
        });
      }
      
      if (startLedger > currentLedger) {
        // Wait for new ledgers
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const endLedger = Math.min(startLedger + 1000, currentLedger);
      logger.info('indexing ledger range', { startLedger, endLedger });

      const ledgerStart = Math.max(1, startLedger - 1);
      const ledgerResponse = await server.getLedgers({
        startLedger: ledgerStart,
        pagination: { limit: endLedger - ledgerStart + 1 },
      });
      const coordinates = ledgerResponse.ledgers
        .filter((ledger) => ledger.sequence >= startLedger && ledger.sequence <= endLedger)
        .map(toLedgerCoordinate);
      const previousCoordinate = lastLedger?.ledger === startLedger - 1 && lastLedger.hash
        ? {
            ledger: lastLedger.ledger,
            hash: lastLedger.hash,
            parentHash: lastLedger.parentHash ?? '',
          }
        : ledgerResponse.ledgers
            .filter((ledger) => ledger.sequence === startLedger - 1)
            .map(toLedgerCoordinate)[0];

      if (
        coordinates.length !== endLedger - startLedger + 1 ||
        !hasContinuousParentChain(coordinates, previousCoordinate)
      ) {
        if (lastLedger) {
          await reconcileLedgerCursor(prisma, server, lastLedger);
        }
        throw new Error(`Ledger sequence or parent hash mismatch at ${startLedger}`);
      }

      const response = await server.getEvents({
        startLedger: startLedger,
        endLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [CONTRACT_ID as string],
          },
        ],
      });

      for (const event of response.events) {
        await processEvent(event);
      }

      const latestCoordinate = coordinates[coordinates.length - 1];
      if (!latestCoordinate) throw new Error(`No ledger coordinates returned through ${endLedger}`);
      await prisma.$transaction([
        prisma.indexedLedger.createMany({ data: coordinates, skipDuplicates: true }),
        prisma.lastIndexedLedger.upsert({
          where: { id: 1 },
          update: {
            ledger: latestCoordinate.ledger,
            hash: latestCoordinate.hash,
            parentHash: latestCoordinate.parentHash,
          },
          create: { id: 1, ...latestCoordinate },
        }),
      ]);

      startLedger = endLedger + 1;

      // Small delay to avoid hammering the RPC
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      logger.error('indexer ingestion error', {
        error: error instanceof Error ? error.message : String(error),
      });
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

/**
 * Resolve the ledger close time for an event, falling back to the current
 * time when the RPC response does not carry a parseable `ledgerClosedAt`.
 */
function ledgerCloseTime(event: SorobanRpc.Api.EventResponse): Date {
  const closedAt = (event as { ledgerClosedAt?: unknown }).ledgerClosedAt;
  if (typeof closedAt === 'string') {
    const parsed = new Date(closedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date();
}

/**
 * Persist an event row and its derived holder/supply aggregates in a single
 * transaction so a re-index cannot apply an event twice.
 */
async function persistEventRow(
  client: PrismaClient,
  model: 'mint' | 'transfer' | 'burn',
  data: Record<string, unknown>,
  ledgerEvent: LedgerEvent,
  event: SorobanRpc.Api.EventResponse,
  newSupply?: string,
): Promise<unknown> {
  const run = async (tx: AggregateStore & Record<string, { create: (args: { data: Record<string, unknown> }) => Promise<unknown> }>) => {
    const created = await (tx as any)[model].create({ data });
    if (typeof (tx as AggregateStore).holder?.upsert === 'function') {
      await applyLedgerEventAggregates(tx as unknown as AggregateStore, ledgerEvent, {
        ledger: event.ledger,
        txHash: event.txHash,
        timestamp: ledgerCloseTime(event),
        newSupply,
      });
    }
    return created;
  };
  const transactional = client as PrismaClient & {
    $transaction?: (fn: (tx: PrismaClient) => Promise<unknown>) => Promise<unknown>;
  };
  if (typeof transactional.$transaction === 'function') {
    return transactional.$transaction((tx) => run(tx as never));
  }
  return run(client as never);
}

export async function processEvent(
  event: SorobanRpc.Api.EventResponse,
  database: PrismaClient = prisma,
) {
  if (!event.topic || event.topic.length === 0) return;
  const topic = scValToNative(event.topic[0] as any);
  const data = event.value as any;

  try {
    // Event schema version (#924): as of schema version 1, every token event
    // data tuple ends with a trailing `version: u32` field (currently 1).
    // This parser reads fixed indices only, so appended fields do not shift
    // the positions below and decoding `version` here is not required.
    // FOLLOW-UP: if a future schema version adds, removes, or reorders
    // fields, switch on the trailing `version` in these cases before
    // interpreting the other elements.
    switch (topic) {
      case 'mint': {
        const decoded = scValToNative(data as any);
        // (admin, to, amount, new_balance, new_supply, version)
        const ledgerEvent: LedgerEvent = {
          type: 'mint',
          to: decoded[1],
          amount: decoded[2].toString(),
        };
        const row = await persistEventRow(
          database,
          'mint',
          {
            to: decoded[1],
            amount: decoded[2].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
          ledgerEvent,
          event,
          decoded[4]?.toString(),
        );
        publishIndexerEvent({ type: 'mint', data: row as unknown as Record<string, unknown> });
        break;
      }
      case 'burn': {
        const decoded = scValToNative(data as any);
        // (from, amount, new_balance, new_supply, version)
        const ledgerEvent: LedgerEvent = {
          type: 'burn',
          from: decoded[0],
          amount: decoded[1].toString(),
        };
        const row = await persistEventRow(
          database,
          'burn',
          {
            from: decoded[0],
            amount: decoded[1].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
          ledgerEvent,
          event,
          decoded[3]?.toString(),
        );
        publishIndexerEvent({ type: 'burn', data: row as unknown as Record<string, unknown> });
        break;
      }
      case 'xfer': {
        const decoded = scValToNative(data as any);
        // (from, to, amount, version)
        const ledgerEvent: LedgerEvent = {
          type: 'transfer',
          from: decoded[0],
          to: decoded[1],
          amount: decoded[2].toString(),
        };
        const row = await persistEventRow(
          database,
          'transfer',
          {
            from: decoded[0],
            to: decoded[1],
            amount: decoded[2].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
          ledgerEvent,
          event,
        );
        publishIndexerEvent({ type: 'transfer', data: row as unknown as Record<string, unknown> });
        break;
      }
      case 'xfer_frm': {
        const decoded = scValToNative(data as any);
        // (spender, from, to, amount, remaining_allowance, version)
        const ledgerEvent: LedgerEvent = {
          type: 'transfer',
          from: decoded[1],
          to: decoded[2],
          amount: decoded[3].toString(),
        };
        const row = await persistEventRow(
          database,
          'transfer',
          {
            from: decoded[1],
            to: decoded[2],
            amount: decoded[3].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
          ledgerEvent,
          event,
        );
        publishIndexerEvent({ type: 'transfer', data: row as unknown as Record<string, unknown> });
        break;
      }
    }
  } catch (err: any) {
    // Unique constraint violation might happen if we re-index a ledger
    if (err.code !== 'P2002') {
      logger.error('event processing error', {
        topic,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
