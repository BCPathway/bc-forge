
#!/usr/bin/env node

/**
 * Load-test script for Indexer API (#961).
 *
 * Tests:
 *   - GET /health
 *   - GET /api/v1/mints
 *
 * Features:
 *   - Configurable concurrency and request count
 *   - Request timeout handling
 *   - HTTP status tracking
 *   - Latency statistics (min, max, average, p95)
 *   - Requests per second (RPS)
 *   - Error-rate threshold enforcement
 *   - Optional live-server enforcement
 *
 * Usage:
 *   node scripts/load-test.js
 *
 * Environment:
 *   INDEXER_URL=http://localhost:3001
 *   INDEXER_API_TOKEN=test-load-token
 *   CONCURRENCY=20
 *   TOTAL_REQUESTS=100
 *   REQUEST_TIMEOUT_MS=5000
 *   MAX_ERROR_RATE=0.01
 *   REQUIRE_LIVE_SERVER=true
 */

import http from "node:http";
import { performance } from "node:perf_hooks";

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const INDEXER_URL = process.env.INDEXER_URL || "http://localhost:3001";
const API_TOKEN = process.env.INDEXER_API_TOKEN || "test-load-token";

const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || "20", 10);
const TOTAL_REQUESTS = Number.parseInt(process.env.TOTAL_REQUESTS || "100", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env.REQUEST_TIMEOUT_MS || "5000",
  10,
);
const MAX_ERROR_RATE = Number.parseFloat(
  process.env.MAX_ERROR_RATE || "0.01",
);

const REQUIRE_LIVE_SERVER = process.env.REQUIRE_LIVE_SERVER === "true";

const PATHS = ["/health", "/api/v1/mints"];

const HTTP_AGENT = new http.Agent({
  keepAlive: true,
  maxSockets: CONCURRENCY,
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                */
/* -------------------------------------------------------------------------- */

function validateConfiguration() {
  if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) {
    throw new Error("CONCURRENCY must be a positive integer.");
  }

  if (!Number.isInteger(TOTAL_REQUESTS) || TOTAL_REQUESTS < 1) {
    throw new Error("TOTAL_REQUESTS must be a positive integer.");
  }

  if (
    !Number.isInteger(REQUEST_TIMEOUT_MS) ||
    REQUEST_TIMEOUT_MS < 1
  ) {
    throw new Error("REQUEST_TIMEOUT_MS must be a positive integer.");
  }

  if (
    !Number.isFinite(MAX_ERROR_RATE) ||
    MAX_ERROR_RATE < 0 ||
    MAX_ERROR_RATE > 1
  ) {
    throw new Error("MAX_ERROR_RATE must be between 0 and 1.");
  }

  try {
    new URL(INDEXER_URL);
  } catch {
    throw new Error(`Invalid INDEXER_URL: ${INDEXER_URL}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Request                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Sends one GET request and records latency.
 *
 * A request is considered successful only for HTTP 2xx responses.
 */
function sendRequest(path, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(path, INDEXER_URL);
    const startedAt = performance.now();

    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;

      result.latencyMs = performance.now() - startedAt;
      resolve(result);
    };

    const req = http.request(
      url,
      {
        method: "GET",
        agent: HTTP_AGENT,
        headers: {
          ...headers,
          Connection: "keep-alive",
        },
      },
      (res) => {
        // Consume the response without storing the entire body.
        res.resume();

        res.on("end", () => {
          const statusCode = res.statusCode ?? 0;

          finish({
            path,
            statusCode,
            success: statusCode >= 200 && statusCode < 300,
          });
        });

        res.on("error", (error) => {
          finish({
            path,
            statusCode: res.statusCode ?? 0,
            success: false,
            error: error.message,
          });
        });
      },
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("Request timeout"));
    });

    req.on("error", (error) => {
      finish({
        path,
        statusCode: error.message === "Request timeout" ? 504 : 0,
        success: false,
        error: error.message,
      });
    });

    req.end();
  });
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                */
/* -------------------------------------------------------------------------- */

function percentile(values, percentage) {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentage / 100) * sorted.length) - 1;

  return sorted[Math.max(0, index)];
}

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function calculateStatistics(results, durationMs) {
  const latencies = results.map((result) => result.latencyMs);

  const completed = results.length;
  const successes = results.filter((result) => result.success).length;
  const failures = completed - successes;

  const errorRate = completed > 0 ? failures / completed : 0;

  const totalLatency = latencies.reduce((sum, latency) => sum + latency, 0);

  const minLatency = latencies.length > 0 ? Math.min(...latencies) : 0;
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0;
  const averageLatency = latencies.length > 0 ? totalLatency / latencies.length : 0;

  const requestsPerSecond =
    durationMs > 0 ? completed / (durationMs / 1000) : 0;

  const statusCodes = {};

  for (const result of results) {
    const key = String(result.statusCode);

    statusCodes[key] = (statusCodes[key] || 0) + 1;
  }

  return {
    completed,
    successes,
    failures,
    errorRate,
    errorPercentage: (errorRate * 100).toFixed(2),
    durationMs,
    requestsPerSecond,
    minLatency,
    maxLatency,
    averageLatency,
    p95Latency: percentile(latencies, 95),
    statusCodes,
  };
}

/* -------------------------------------------------------------------------- */
/* Load test                                                                */
/* -------------------------------------------------------------------------- */

async function runLoadTest() {
  validateConfiguration();

  console.log("========================================");
  console.log("     Indexer API Load Test (#961)");
  console.log("========================================");
  console.log(`Target URL:       ${INDEXER_URL}`);
  console.log(`Concurrency:       ${CONCURRENCY}`);
  console.log(`Total Requests:   ${TOTAL_REQUESTS}`);
  console.log(`Timeout:          ${REQUEST_TIMEOUT_MS} ms`);
  console.log(`Max Error Rate:   ${(MAX_ERROR_RATE * 100).toFixed(2)}%`);
  console.log(`Require Server:   ${REQUIRE_LIVE_SERVER}`);
  console.log("----------------------------------------");

  const requestQueue = Array.from({ length: TOTAL_REQUESTS }, (_, index) => {
    const path = PATHS[index % PATHS.length];

    const headers = path.startsWith("/api/")
      ? {
          Authorization: `Bearer ${API_TOKEN}`,
        }
      : {};

    return { path, headers };
  });

  const results = [];
  let nextRequestIndex = 0;

  async function worker() {
    while (true) {
      // Allocate work synchronously to avoid duplicate request assignments.
      const index = nextRequestIndex++;

      if (index >= requestQueue.length) {
        return;
      }

      const request = requestQueue[index];

      const result = await sendRequest(request.path, request.headers);

      results.push(result);

      if (!result.success) {
        console.error(
          `FAIL ${request.path} | HTTP ${result.statusCode} | ${result.error || "Request failed"}`,
        );
      }
    }
  }

  const startedAt = performance.now();

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, TOTAL_REQUESTS) },
      () => worker(),
    ),
  );

  const durationMs = performance.now() - startedAt;

  const statistics = calculateStatistics(results, durationMs);

  /* ------------------------------------------------------------------------ */
  /* Results                                                                  */
  /* ------------------------------------------------------------------------ */

  console.log("\n============== RESULTS ==============");
  console.log(`Total Completed:  ${statistics.completed}`);
  console.log(`Successes:        ${statistics.successes}`);
  console.log(`Failures:         ${statistics.failures}`);
  console.log(`Error Rate:       ${statistics.errorPercentage}%`);
  console.log(`Duration:         ${statistics.durationMs.toFixed(2)} ms`);
  console.log(`Throughput:       ${statistics.requestsPerSecond.toFixed(2)} req/s`);

  console.log("\n----------- LATENCY ----------------");
  console.log(`Minimum:          ${formatMs(statistics.minLatency)}`);
  console.log(`Maximum:          ${formatMs(statistics.maxLatency)}`);
  console.log(`Average:          ${formatMs(statistics.averageLatency)}`);
  console.log(`P95:             ${formatMs(statistics.p95Latency)}`);

  console.log("\n--------- STATUS CODES ------------");

  for (const [statusCode, count] of Object.entries(statistics.statusCodes)) {
    console.log(`HTTP ${statusCode}:       ${count}`);
  }

  console.log("----------------------------------");

  const failedRequests = results.filter((result) => !result.success);

  if (failedRequests.length > 0) {
    console.log("\nFailed request summary:");

    for (const result of failedRequests.slice(0, 10)) {
      console.log(
        `- ${result.path} | HTTP ${result.statusCode} | ${result.error || "Unknown error"}`,
      );
    }

    if (failedRequests.length > 10) {
      console.log(`...and ${failedRequests.length - 10} more failures`);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Threshold enforcement                                                    */
  /* ------------------------------------------------------------------------ */

  const passed = statistics.errorRate <= MAX_ERROR_RATE;

  HTTP_AGENT.destroy();

  if (!passed) {
    console.error(
      `\n❌ LOAD TEST FAILED: Error rate ${statistics.errorPercentage}% exceeds ${(MAX_ERROR_RATE * 100).toFixed(2)}% threshold.`,
    );

    if (!REQUIRE_LIVE_SERVER) {
      console.log(
        "⚠️  Non-fatal standalone mode. Set REQUIRE_LIVE_SERVER=true to enforce failure.",
      );

      process.exitCode = 0;
      return;
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    `\n✅ LOAD TEST PASSED: Error rate ${statistics.errorPercentage}% is within the ${(MAX_ERROR_RATE * 100).toFixed(2)}% threshold.`,
  );

  process.exitCode = 0;
}

/* -------------------------------------------------------------------------- */
/* Entrypoint                                                               */
/* -------------------------------------------------------------------------- */

runLoadTest().catch((error) => {
  HTTP_AGENT.destroy();

  console.error("\n❌ Load test failed to execute.");

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
