import express from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = express.Router();

/**
 * GET /mints
 * Retrieve mint logs.
 */
router.get('/mints', async (req, res) => {
  const mints = await prisma.mint.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(mints);
});

/**
 * GET /transfers
 * Retrieve transfer logs.
 */
router.get('/transfers', async (req, res) => {
  const transfers = await prisma.transfer.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(transfers);
});

/**
 * GET /burns
 * Retrieve burn logs.
 */
router.get('/burns', async (req, res) => {
  const burns = await prisma.burn.findMany({
    orderBy: { createdAt: 'desc' },
  });
  res.json(burns);
});

/**
 * GET /stats
 * Retrieve basic token operation stats.
 */
router.get('/stats', async (req, res) => {
  const [mintCount, transferCount, burnCount] = await Promise.all([
    prisma.mint.count(),
    prisma.transfer.count(),
    prisma.burn.count(),
  ]);

  res.json({
    mintCount,
    transferCount,
    burnCount,
  });
});

export default router;
