import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  computeWebhookSignature,
  deliverIndexerEventToWebhooks,
  setWebhookFetchForTests,
  verifyWebhookSignature,
  type IndexerEvent,
} from "./events";
import { setPrismaClientFactoryForTests } from "./lib/prisma";

afterEach(() => {
  setWebhookFetchForTests();
  setPrismaClientFactoryForTests();
  delete process.env.INDEXER_WEBHOOK_SECRET;
});

test("registered webhook receives the same event payload and retries once after failure", async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        webhook: {
          findMany: async () => [
            { id: "hook-1", url: "https://hooks.example.test/events" },
          ],
        },
      }) as never,
  );

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setWebhookFetchForTests(async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: calls.length === 1 ? 503 : 204 });
  });

  const event: IndexerEvent = {
    type: "mint",
    data: { id: "mint-1", to: "GABC", amount: "10", ledger: 123 },
  };

  await deliverIndexerEventToWebhooks(event);

  assert.equal(
    calls.length,
    2,
    "one failed delivery should be retried exactly once",
  );
  assert.equal(calls[0]?.url, "https://hooks.example.test/events");
  assert.equal(calls[1]?.url, "https://hooks.example.test/events");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[0]?.init?.body, JSON.stringify(event));
  assert.equal(calls[1]?.init?.body, JSON.stringify(event));
  const headers0 = calls[0]?.init?.headers as Record<string, string>;
  assert.ok(headers0?.["x-indexer-signature"]);
  assert.ok(headers0?.["x-indexer-timestamp"]);
});

test("successful webhook delivery is not retried", async () => {
  setPrismaClientFactoryForTests(
    () =>
      ({
        webhook: {
          findMany: async () => [
            { id: "hook-2", url: "https://hooks.example.test/ok" },
          ],
        },
      }) as never,
  );

  let calls = 0;
  setWebhookFetchForTests(async () => {
    calls += 1;
    return new Response(null, { status: 204 });
  });

  await deliverIndexerEventToWebhooks({
    type: "burn",
    data: { id: "burn-1", from: "GABC", amount: "2", ledger: 124 },
  });

  assert.equal(calls, 1);
});

test("outgoing webhooks include HMAC-SHA256 signature and timestamp headers (#1321)", async () => {
  const secret = "super-secret-test-key";
  process.env.INDEXER_WEBHOOK_SECRET = secret;

  setPrismaClientFactoryForTests(
    () =>
      ({
        webhook: {
          findMany: async () => [
            { id: "hook-sig", url: "https://hooks.example.test/sig" },
          ],
        },
      }) as never,
  );

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  setWebhookFetchForTests(async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  });

  const event: IndexerEvent = {
    type: "transfer",
    data: { id: "tx-1", from: "GAAA", to: "GBBB", amount: "50", ledger: 456 },
  };

  await deliverIndexerEventToWebhooks(event);

  assert.equal(calls.length, 1);
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.ok(headers);
  assert.equal(headers["content-type"], "application/json");
  assert.ok(headers["x-indexer-timestamp"]);
  const timestampNum = Number(headers["x-indexer-timestamp"]);
  assert.ok(!Number.isNaN(timestampNum) && timestampNum > 0);

  const signature = headers["x-indexer-signature"];
  assert.ok(signature);
  assert.match(signature, /^sha256=[a-f0-9]{64}$/);

  const payload = JSON.stringify(event);
  assert.equal(signature, computeWebhookSignature(payload, secret));
  assert.equal(verifyWebhookSignature(payload, signature, secret), true);
  assert.equal(
    verifyWebhookSignature(payload, signature, "wrong-secret"),
    false,
  );
  assert.equal(
    verifyWebhookSignature("tampered payload", signature, secret),
    false,
  );
});
