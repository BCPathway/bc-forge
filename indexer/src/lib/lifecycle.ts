import { logger } from './logger';

/**
 * Lifecycle log emitters for the indexer process.
 *
 * Kept as small exported functions (rather than inline in `index.ts`) so
 * the startup/shutdown/failure log lines are unit-testable without booting
 * the HTTP server or the background indexer. Each emits exactly one JSON
 * line to stdout via the structured logger; secrets are scrubbed by the
 * logger itself.
 */

/** Log process startup. Called once the HTTP server is listening. */
export function logStartup(port: string | number): void {
  logger.info('indexer microservice API listening', { port });
}

/** Log the start of graceful shutdown. */
export function logShutdown(signal: string): void {
  logger.info('shutting down, disconnecting Prisma client', { signal });
}

/** Log a fatal background-indexer failure before the process exits. */
export function logFatalIndexerError(err: unknown): void {
  logger.error('fatal indexer error', {
    error: err instanceof Error ? err.message : String(err),
  });
}
