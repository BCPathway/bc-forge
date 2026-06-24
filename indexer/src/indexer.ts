import { SorobanRpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID: string = process.env.CONTRACT_ID ?? '';

if (!CONTRACT_ID) {
  throw new Error('CONTRACT_ID environment variable is required');
}

const server = new SorobanRpc.Server(RPC_URL);

export const GAP_THRESHOLD = 100;

export interface GapInfo {
  startLedger: number;
  isGap: boolean;
  gapSize: number;
  isFirstRun: boolean;
}

export function detectGap(
  storedLedger: number | undefined | null,
  currentLedger: number,
): GapInfo {
  if (currentLedger < 1) {
    throw new Error(`Invalid currentLedger: ${currentLedger}. Must be >= 1.`);
  }

  if (storedLedger == null) {
    console.log('No previously indexed ledger found. Starting from ledger 1.');
    return { startLedger: 1, isGap: false, gapSize: 0, isFirstRun: true };
  }

  const startLedger = storedLedger + 1;

  if (startLedger > currentLedger) {
    console.warn(
      `WARNING: Last indexed ledger (${storedLedger}) is ahead of the network ledger (${currentLedger}). ` +
      `This may indicate a network reset or database inconsistency. Resetting start to current ledger.`,
    );
    return { startLedger: currentLedger, isGap: true, gapSize: 0, isFirstRun: false };
  }

  const gapSize = currentLedger - startLedger;

  if (gapSize > GAP_THRESHOLD) {
    console.warn(
      `Gap detected: indexer is ${gapSize} ledgers behind ` +
      `(start=${startLedger}, current=${currentLedger}). Catching up...`,
    );
    return { startLedger, isGap: true, gapSize, isFirstRun: false };
  }

  return { startLedger, isGap: false, gapSize, isFirstRun: false };
}

export async function startupGapCheck(): Promise<number> {
  const lastLedger = await prisma.lastIndexedLedger.findUnique({ where: { id: 1 } });
  const currentLedger = (await server.getLatestLedger()).sequence;
  const gapInfo = detectGap(lastLedger?.ledger, currentLedger);

  if (gapInfo.isGap || gapInfo.isFirstRun) {
    console.log(
      `Resuming from ledger ${gapInfo.startLedger} ` +
      `(gap=${gapInfo.gapSize}, firstRun=${gapInfo.isFirstRun})`,
    );
  }

  return gapInfo.startLedger;
}

export async function runIndexer() {
  console.log(`Starting indexer for contract: ${CONTRACT_ID}`);

  let startLedger = await startupGapCheck();

  while (true) {
    try {
      const latestLedger = (await server.getLatestLedger()).sequence;

      if (startLedger > latestLedger) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const endLedger = Math.min(startLedger + 1000, latestLedger);
      console.log(`Indexing ledgers: ${startLedger} to ${endLedger}`);

      const response = await server.getEvents({
        startLedger: startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [CONTRACT_ID],
          },
        ],
      });

      for (const event of response.events) {
        await processEvent(event as any);
      }

      await prisma.lastIndexedLedger.upsert({
        where: { id: 1 },
        update: { ledger: endLedger },
        create: { id: 1, ledger: endLedger },
      });

      startLedger = endLedger + 1;

      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Indexer error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function processEvent(event: any) {
  const topic = scValToNative(event.topic[0]);
  const data = event.value;

  try {
    switch (topic) {
      case 'mint': {
        const decoded = scValToNative(data);
        await prisma.mint.create({
          data: {
            to: decoded[1],
            amount: decoded[2].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
        });
        break;
      }
      case 'burn': {
        const decoded = scValToNative(data);
        await prisma.burn.create({
          data: {
            from: decoded[0],
            amount: decoded[1].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
        });
        break;
      }
      case 'xfer': {
        const decoded = scValToNative(data);
        await prisma.transfer.create({
          data: {
            from: decoded[0],
            to: decoded[1],
            amount: decoded[2].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
        });
        break;
      }
      case 'xfer_frm': {
        const decoded = scValToNative(data);
        await prisma.transfer.create({
          data: {
            from: decoded[1],
            to: decoded[2],
            amount: decoded[3].toString(),
            ledger: event.ledger,
            txHash: event.txHash,
          },
        });
        break;
      }
    }
  } catch (err: any) {
    if (err.code !== 'P2002') {
      console.error(`Error processing event topic ${topic}:`, err);
    }
  }
}
