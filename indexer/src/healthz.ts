import type { Request, Response } from 'express';
import { getLatestNetworkLedger } from './metrics';
import { getPrismaClient } from './lib/prisma';

export async function healthzHandler(_req: Request, res: Response): Promise<void> {
  const cursor = await getPrismaClient().lastIndexedLedger.findUnique({ where: { id: 1 } });
  const latestNetworkLedger = getLatestNetworkLedger();
  const lastIndexedLedger = cursor?.ledger ?? 0;
  const lag = Math.max(0, latestNetworkLedger - lastIndexedLedger);

  res.status(200).json({
    status: 'ok',
    lastIndexedLedger,
    latestNetworkLedger,
    lag,
  });
}