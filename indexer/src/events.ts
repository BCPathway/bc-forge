import { EventEmitter } from "node:events";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPrismaClient } from "./lib/prisma";
import { logger } from "./lib/logger";

export type IndexerEventType =
  | "mint"
  | "transfer"
  | "burn"
  | "vaultDeposit"
  | "wrapperUpdate"
  | "vestingClaim"
  | "splitDistribution";

export type IndexerEvent = {
  type: IndexerEventType;
  data: Record<string, unknown>;
};

type IndexerEventListener = (event: IndexerEvent) => void;

export type WebhookTarget = {
  id: string;
  url: string;
  secret?: string;
};

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);

let webhookFetch: FetchLike = globalThis.fetch.bind(globalThis);

/**
 * Compute the HMAC-SHA256 signature for outgoing webhook delivery (#1321).
 *
 * Format: `sha256=${hexDigest}`
 */
export function computeWebhookSignature(
  payload: string,
  secret: string,
): string {
  const digest = createHmac("sha256", secret).update(payload).digest("hex");
  return `sha256=${digest}`;
}

/**
 * Verify an HMAC-SHA256 signature for incoming webhook payloads (#1321).
 */
export function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }
  const expected = computeWebhookSignature(payload, secret);
  if (expected.length !== signatureHeader.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
}

/**
 * Subscribe to newly persisted indexer events.
 *
 * Returns an unsubscribe callback so long-lived SSE clients can detach when
 * their connection closes.
 */
export function subscribeIndexerEvents(
  listener: IndexerEventListener,
): () => void {
  eventBus.on("event", listener);
  return () => {
    eventBus.off("event", listener);
  };
}

/**
 * Deliver one event to one webhook, retrying exactly once after a failed
 * request or non-2xx response.
 */
async function deliverWebhook(
  target: WebhookTarget,
  event: IndexerEvent,
): Promise<void> {
  let lastError: unknown;
  const payload = JSON.stringify(event);
  const timestamp = Date.now().toString();
  const secret = target.secret ?? process.env.INDEXER_WEBHOOK_SECRET ?? "";
  const signature = computeWebhookSignature(payload, secret);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await webhookFetch(target.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-indexer-signature": signature,
          "x-indexer-timestamp": timestamp,
        },
        body: payload,
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      if (attempt > 1) {
        logger.info("webhook delivery recovered after retry", {
          webhookId: target.id,
          eventType: event.type,
        });
      }
      return;
    } catch (error: unknown) {
      lastError = error;
      logger.warn("webhook delivery attempt failed", {
        webhookId: target.id,
        eventType: event.type,
        attempt,
        error,
      });
    }
  }

  logger.error("webhook delivery failed after retry", {
    webhookId: target.id,
    eventType: event.type,
    error: lastError,
  });
}

/**
 * POST an indexer event to every registered webhook.
 *
 * Targets are delivered concurrently. One broken hook never prevents another
 * hook from receiving the event.
 */
export async function deliverIndexerEventToWebhooks(
  event: IndexerEvent,
): Promise<void> {
  const targets = (await getPrismaClient().webhook.findMany({
    select: { id: true, url: true },
  })) as WebhookTarget[];

  await Promise.allSettled(
    targets.map((target) => deliverWebhook(target, event)),
  );
}

/**
 * Publish an event after its database row has been committed.
 *
 * SSE subscribers are notified synchronously, while webhook I/O is deliberately
 * detached from the indexer loop so a slow or unavailable endpoint cannot block
 * ledger ingestion.
 */
export function publishIndexerEvent(event: IndexerEvent): void {
  eventBus.emit("event", event);

  void deliverIndexerEventToWebhooks(event).catch((error: unknown) => {
    logger.error("failed to load or deliver registered webhooks", {
      eventType: event.type,
      error,
    });
  });
}

/** Test-only hook for deterministic webhook delivery tests. */
export function setWebhookFetchForTests(fetchImpl?: FetchLike): void {
  webhookFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
}
