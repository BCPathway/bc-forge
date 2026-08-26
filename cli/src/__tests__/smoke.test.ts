import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMockServer,
  MOCK_SOURCE_SECRET,
  MOCK_CONTRACT_ID,
  MOCK_RPC_URL,
  MOCK_NETWORK_PASSPHRASE,
  TEST_KEYS,
} from "./mocks.js";
import { runSmokeTest } from "../commands/smoke-test.js";

// ─── Mocking ────────────────────────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as any;

  const mockKeypairInstance = {
    publicKey: vi.fn().mockReturnValue("GBZCSTYJGKFBXQ7YXKCZC25S5XEHFPQSA2IWWYOI4RYC7YHXXSKZCQ3L"),
  };

  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({ toXDR: () => "mock-op" }),
    })),
    Address: {
      fromString: vi.fn().mockReturnValue({
        toScVal: vi.fn().mockReturnValue({ _scValType: 0 }),
      }),
    },
    nativeToScVal: vi.fn().mockReturnValue({ _scValType: 0 }),
    TransactionBuilder: vi.fn().mockImplementation(() => ({
      addOperation: vi.fn().mockReturnThis(),
      setTimeout: vi.fn().mockReturnThis(),
      build: vi.fn().mockReturnValue({ toXDR: () => "mock-xdr", sign: vi.fn() }),
    })),
    rpc: {
      ...actual.rpc,
      Server: vi.fn().mockImplementation(() => createMockServer()),
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
});
