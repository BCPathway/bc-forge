/**
 * Prisma seed script for the bc-forge indexer database.
 *
 * Deliberately inserts NO secrets and only a handful of sample rows, every
 * one of them clearly marked as seed data:
 *
 * - addresses are the invalid-but-unambiguous placeholder `SEED_DATA_ADDRESS`
 * - amounts are the token's smallest meaningful string, "1"
 * - the ledger is 0, a value no real ledger ever has
 * - every row gets a `seed-` prefixed txHash so it is trivially
 *   distinguishable from rows produced by the indexer
 *
 * Run with `npm run db:seed` (or automatically by `prisma migrate reset`).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Placeholder address used for every seeded row (not a real Stellar key). */
const SEED_ADDRESS = 'SEED_DATA_ADDRESS';
/** Placeholder txHash used for every seeded row. */
const SEED_TX_HASH = 'seed-tx-0000';
/** Ledger 0 never occurs on chain, so these rows can never be confused with real indexed data. */
const SEED_LEDGER = 0;

async function main(): Promise<void> {
  const mint = await prisma.mint.upsert({
    where: { txHash: SEED_TX_HASH },
    update: {},
    create: {
      to: SEED_ADDRESS,
      amount: '1',
      ledger: SEED_LEDGER,
      txHash: SEED_TX_HASH,
    },
  });

  const transfer = await prisma.transfer.upsert({
    where: { txHash: SEED_TX_HASH },
    update: {},
    create: {
      from: SEED_ADDRESS,
      to: SEED_ADDRESS,
      amount: '1',
      ledger: SEED_LEDGER,
      txHash: SEED_TX_HASH,
    },
  });

  const burn = await prisma.burn.upsert({
    where: { txHash: SEED_TX_HASH },
    update: {},
    create: {
      from: SEED_ADDRESS,
      amount: '1',
      ledger: SEED_LEDGER,
      txHash: SEED_TX_HASH,
    },
  });

  console.log('Seed data written (ledger 0 and `seed-` txHash mark these as sample rows):');
  console.log(`  Mint:     ${mint.id}`);
  console.log(`  Transfer: ${transfer.id}`);
  console.log(`  Burn:     ${burn.id}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
