import { describe, it, expect } from "vitest";
import { runSmokeTest } from "../commands/smoke-test.js";
import { NETWORK_PRESETS } from "../network.js";

/**
 * Live E2E: exercises the CLI's deployment flow against the real Stellar
 * Testnet (#708). This talks to a public RPC node and needs a funded testnet
 * account plus a deployed token contract it administers, so it is opt-in and
 * skipped by default — a normal `npm test` (and CI) never depends on live
 * network availability or funded credentials.
 *
 * To run locally:
 *   RUN_E2E_TESTNET=true \
 *   E2E_TESTNET_SECRET=S... \
 *   E2E_TOKEN_CONTRACT_ID=C... \
 *   npm test -- e2e-testnet
 */
const enabled = process.env.RUN_E2E_TESTNET === "true";
const secret = process.env.E2E_TESTNET_SECRET;
const contractId = process.env.E2E_TOKEN_CONTRACT_ID;

describe.skipIf(!enabled || !secret || !contractId)("CLI E2E: Testnet deployment flow (#708)", () => {
  const testnet = NETWORK_PRESETS.testnet;
  const rpcUrl = process.env.E2E_TESTNET_RPC_URL || testnet.rpcUrl;
  const networkPassphrase = process.env.E2E_TESTNET_PASSPHRASE || testnet.networkPassphrase;

  it(
    "mints and transfers against a live Testnet contract, confirming within a generous budget",
    async () => {
      const result = await runSmokeTest({
        contractId: contractId as string,
        rpcUrl,
        networkPassphrase,
        source: secret as string,
        amount: "1",
        timeout: 60000,
      });

      expect(result.success, result.message).toBe(true);
      expect(result.sequence).toEqual(
        expect.arrayContaining(["mint_ok", "transfer_ok", "final_balance_ok"])
      );
      expect(result.details?.mintHash).toBeDefined();
      expect(result.details?.transferHash).toBeDefined();
    },
    90000
  );

  it(
    "reports a timeout instead of hanging when given a budget real network latency can't meet",
    async () => {
      const result = await runSmokeTest({
        contractId: contractId as string,
        rpcUrl,
        networkPassphrase,
        source: secret as string,
        amount: "1",
        timeout: 1,
      });

      expect(result.success).toBe(false);
    },
    30000
  );
});
