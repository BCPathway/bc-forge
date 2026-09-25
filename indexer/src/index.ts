import express from 'express';
import { runIndexer } from './indexer';
import apiRouter, { jsonErrorHandler } from './api';
import { disconnectPrismaClient } from './lib/prisma';
import { logger } from './lib/logger';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// API Layer
app.use('/api/v1', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// JSON error handler (registered after all routes).
app.use(jsonErrorHandler);

app.listen(PORT, () => {
  logger.info('indexer microservice API listening', { port: PORT });

  // Start the indexer background process
  runIndexer().catch(err => {
    logger.error('fatal indexer error', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
});

async function shutdown(signal: string): Promise<void> {
  logger.info('shutting down, disconnecting Prisma client', { signal });
  await disconnectPrismaClient();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
