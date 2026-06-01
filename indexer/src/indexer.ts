import { SorobanRpc, xdr, scValToNative } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const prisma = new PrismaClient();

const RPC_URL = process.env.RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.CONTRACT_ID;

if (!CONTRACT_ID) {
  throw new Error('CONTRACT_ID environment variable is required');
}

const server = new SorobanRpc.Server(RPC_URL);

/**
 * Main indexer loop to fetch and process Soroban events.
 */
export async function runIndexer() {
  console.log(`Starting indexer for contract: ${CONTRACT_ID}`);

  // 1. Get the last indexed ledger
  let lastLedger = await prisma.lastIndexedLedger.findUnique({ where: { id: 1 } });
  let startLedger = lastLedger ? lastLedger.ledger + 1 : 0;

  // 2. Continuous loop
  while (true) {
    try {
      const currentLedger = (await server.getLatestLedger()).sequence;
      
      if (startLedger > currentLedger) {
        // Wait for new ledgers
        await new Promise(resolve => setTimeout(resolve, 5000));
        continue;
      }

      const endLedger = Math.min(startLedger + 1000, currentLedger);
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
        await processEvent(event);
      }

      // Update last indexed ledger
      await prisma.lastIndexedLedger.upsert({
        where: { id: 1 },
        update: { ledger: endLedger },
        create: { id: 1, ledger: endLedger },
      });

      startLedger = endLedger + 1;

      // Small delay to avoid hammering the RPC
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Indexer error:', error);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

async function processEvent(event: SorobanRpc.Api.RawEventResponse) {
  const topic = scValToNative(event.topic[0]);
  const data = event.value;

  try {
    switch (topic) {
      case 'mint': {
        const decoded = scValToNative(data);
        // (admin, to, amount, new_balance, new_supply)
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
        // (from, amount, new_balance, new_supply)
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
        // (from, to, amount)
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
        // (spender, from, to, amount, remaining_allowance)
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
    // Unique constraint violation might happen if we re-index a ledger
    if (err.code !== 'P2002') {
      console.error(`Error processing event topic ${topic}:`, err);
    }
  }
}
