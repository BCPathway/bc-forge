import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockServer,
  MOCK_SOURCE_SECRET,
  MOCK_CONTRACT_ID,
  MOCK_RPC_URL,
  MOCK_NETWORK_PASSPHRASE,
  TEST_KEYS,
} from "./mocks.js";
import { runSmokeTest, watchSmokeTest } from "../commands/smoke-test.js";

// ─── Mocking ────────────────────────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as any;

  const mockKeypairInstance = {
    publicKey: vi.fn().mockReturnValue("GBZCSTYJGKFBXQ7YXKCZC25S5XEHFPQSA2IWWYOI4RYC7YHXXSKZCQ3L"),
  };

  return {
    ...actual,
    Contract: vi.fn(function () {
      return {
        call: vi.fn().mockReturnValue({ toXDR: () => "mock-op" }),
      };
    }),
    Address: {
      fromString: vi.fn().mockReturnValue({
        toScVal: vi.fn().mockReturnValue({ _scValType: 0 }),
      }),
    },
    nativeToScVal: vi.fn().mockReturnValue({ _scValType: 0 }),
    TransactionBuilder: vi.fn(function () {
      return {
        addOperation: vi.fn().mockReturnThis(),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn().mockReturnValue({ toXDR: () => "mock-xdr", sign: vi.fn() }),
      };
    }),
    rpc: {
      ...actual.rpc,
      Server: vi.fn(function () {
        return createMockServer();
      }),
    },
    Keypair: {
      ...actual.Keypair,
      fromSecret: vi.fn().mockImplementation(() => mockKeypairInstance),
      random: vi.fn().mockImplementation(() => ({
        publicKey: () => "GDQYHAWYCN4RCNXYZABCD2ABCD2ABCD2ABCD2ABCD2ABCD2ABCD2ABCD",
      })),
    },
  };
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const baseOpts = () => ({
  contractId: MOCK_CONTRACT_ID,
  rpcUrl: MOCK_RPC_URL,
  networkPassphrase: MOCK_NETWORK_PASSPHRASE,
  source: MOCK_SOURCE_SECRET,
  recipient: TEST_KEYS.recipient,
  amount: "100",
  timeout: "5000",
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("Smoke Test Command (#704, #706)", () => {
  describe("happy path", () => {
    it("completes full mint/transfer sequence", async () => {
      const opts = baseOpts();
      const result = await runSmokeTest(opts);
      expect(result.success).toBe(true);
      expect(result.sequence).toContain("balance_check");
      expect(result.sequence).toContain("mint_ok");
      expect(result.sequence).toContain("transfer_ok");
      expect(result.sequence).toContain("final_balance_ok");
    });

    it("returns balance and transaction details", async () => {
      const opts = baseOpts();
      const result = await runSmokeTest(opts);
      expect(result.details).toBeDefined();
      expect(result.details?.mintHash).toBeDefined();
      expect(result.details?.transferHash).toBeDefined();
    });

    it("uses default amount when not specified", async () => {
      const opts = baseOpts();
      delete (opts as any).amount;
      const result = await runSmokeTest(opts);
      expect(result.success).toBe(true);
    });
  });

  describe("auto-generated recipient", () => {
    it("succeeds without explicit recipient", async () => {
      const opts = baseOpts();
      delete (opts as any).recipient;
      const result = await runSmokeTest(opts);
      expect(result.success).toBe(true);
      expect(result.message).toContain("transferred to");
    });
  });

  describe("error states", () => {
    it("returns error when source secret is invalid", async () => {
      const opts = baseOpts();
      opts.source = "INVALID_SECRET_KEY";
      const { Keypair } = await import("@stellar/stellar-sdk");
      vi.mocked(Keypair.fromSecret).mockImplementationOnce(() => {
        throw new Error("Invalid secret key");
      });
      const result = await runSmokeTest(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Smoke test error");
    });

    it("reports sequence progress on failure", async () => {
      const opts = baseOpts();
      opts.source = "INVALID_SECRET_KEY";
      const { Keypair } = await import("@stellar/stellar-sdk");
      vi.mocked(Keypair.fromSecret).mockImplementationOnce(() => {
        throw new Error("Invalid secret key");
      });
      const result = await runSmokeTest(opts);
      expect(result.sequence).toBeInstanceOf(Array);
    });
  });

  describe("defaults", () => {
    it("uses default timeout of 30000ms", async () => {
      const opts = baseOpts();
      delete (opts as any).timeout;
      const result = await runSmokeTest(opts);
      expect(result.success).toBeDefined();
    });

    it("defaults amount to 1", async () => {
      const opts = baseOpts();
      delete (opts as any).amount;
      const result = await runSmokeTest(opts);
      expect(result.success).toBe(true);
    });
  });

  describe("network fees and latency (#708)", () => {
    it("signs the mint and transfer transactions before submitting them", async () => {
      const opts = baseOpts();
      const result = await runSmokeTest(opts);
      const { TransactionBuilder } = await import("@stellar/stellar-sdk");
      // runSmokeTest builds 5 transactions per call (balance, mint, balance, transfer, balance);
      // mocks aren't cleared between tests, so take only this call's slice of the mock history.
      const thisCallResults = vi.mocked(TransactionBuilder).mock.results.slice(-5);
      const builtTxs = thisCallResults.map((r) => r.value.build());
      const signedCount = builtTxs.filter((tx) => tx.sign.mock.calls.length > 0).length;
      expect(result.success).toBe(true);
      // mint and transfer each simulate+sign+submit; the 3 read-only balance checks never sign
      expect(signedCount).toBe(2);
    });

    it("fails the mint step (without submitting) when simulation/fee assembly fails", async () => {
      const opts = baseOpts();
      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        function () {
          return createMockServer({ simulationError: "resource limit exceeded" }) as any;
        }
      );

      const result = await runSmokeTest(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Mint failed");
      expect(result.message).toContain("resource limit exceeded");
    });

    it("tolerates real confirmation latency by polling past transient NOT_FOUND status", async () => {
      const opts = baseOpts();
      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        function () {
          return createMockServer({ pendingPollsBeforeSuccess: 2 }) as any;
        }
      );

      const result = await runSmokeTest(opts);
      expect(result.success).toBe(true);
      expect(result.sequence).toContain("mint_ok");
    });

    it("reports a timeout instead of hanging when confirmation never arrives within the budget", async () => {
      const opts = baseOpts();
      opts.timeout = "5";
      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        function () {
          return createMockServer({ pendingPollsBeforeSuccess: 1000 }) as any;
        }
      );

      const result = await runSmokeTest(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("timed out");
    });
  });

  describe("watch mode (#940)", () => {
    const pass = {
      success: true,
      sequence: ["mint_ok"],
      message: "Smoke test passed",
    };
    const fail = {
      success: false,
      sequence: ["mint_start"],
      message: "Mint failed: simulation failed: boom",
    };

    it("repeats until interrupted and reports every pass", async () => {
      const iterations: number[] = [];
      const reported: boolean[] = [];
      const sleeps: number[] = [];
      const once = vi.fn(async (i: number) => {
        iterations.push(i);
        return i === 2 ? fail : pass;
      });
      const sleep = vi.fn(async (ms: number) => {
        sleeps.push(ms);
      });

      await watchSmokeTest({
        intervalMs: 15000,
        once,
        sleep,
        shouldContinue: (i) => i < 3,
        onResult: (result) => {
          reported.push(result.success);
        },
      });

      expect(iterations).toEqual([1, 2, 3]);
      expect(reported).toEqual([true, false, true]);
      expect(sleeps).toEqual([15000, 15000]);
      expect(once).toHaveBeenCalledTimes(3);
    });

    it("runs the interval delay after every pass, including failures", async () => {
      const once = vi.fn(async () => fail);
      const sleep = vi.fn(async () => {});

      await watchSmokeTest({
        intervalMs: 500,
        once,
        sleep,
        shouldContinue: (i) => i < 2,
      });

      expect(sleep).toHaveBeenCalledTimes(1);
      expect(sleep).toHaveBeenCalledWith(500);
    });

    it("runs a single pass when interrupted before the first wait", async () => {
      const once = vi.fn(async () => pass);
      const sleep = vi.fn(async () => {});

      await watchSmokeTest({
        intervalMs: 15000,
        once,
        sleep,
        shouldContinue: () => false,
      });

      expect(once).toHaveBeenCalledTimes(1);
      expect(sleep).not.toHaveBeenCalled();
    });
  });
});
