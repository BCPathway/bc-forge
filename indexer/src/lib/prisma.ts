import { PrismaClient } from '@prisma/client';

type PrismaFactory = () => PrismaClient;

type PrismaGlobal = typeof globalThis & {
  __bcForgePrismaClient?: PrismaClient;
  __bcForgePrismaFactory?: PrismaFactory;
};

const prismaGlobal = globalThis as PrismaGlobal;

const defaultFactory: PrismaFactory = () => new PrismaClient();

let prismaFactory: PrismaFactory = prismaGlobal.__bcForgePrismaFactory ?? defaultFactory;

/**
 * Returns the shared Prisma client for the indexer process.
 *
 * We keep a single instance in module/global scope so the API surface and
 * the background indexer reuse the same connection pool instead of creating
 * a fresh pool on every import or hot-reload cycle.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaGlobal.__bcForgePrismaClient) {
    prismaGlobal.__bcForgePrismaClient = prismaFactory();
  }

  return prismaGlobal.__bcForgePrismaClient;
}

/**
 * Test helper that swaps the client factory and clears the cached instance.
 */
export function setPrismaClientFactoryForTests(factory?: PrismaFactory): void {
  prismaFactory = factory ?? defaultFactory;
  prismaGlobal.__bcForgePrismaFactory = factory;
  delete prismaGlobal.__bcForgePrismaClient;
}

/**
 * Disconnect the shared client if one has been created.
 */
export async function disconnectPrismaClient(): Promise<void> {
  const client = prismaGlobal.__bcForgePrismaClient;
  if (client) {
    await client.$disconnect();
  }
}
