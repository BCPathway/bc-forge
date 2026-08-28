import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockServer,
  MOCK_SOURCE_SECRET,
  MOCK_CONTRACT_ID,
  MOCK_RPC_URL,
  MOCK_NETWORK_PASSPHRASE,
} from "./mocks.js";
import { runUpgrade } from "../commands/upgrade.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ─── Mocking ────────────────────────────────────────────────────────────────────

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as any;

  const mockKeypairInstance = {
    publicKey: vi.fn().mockReturnValue("GBZCSTYJGKFBXQ7YXKCZC25S5XEHFPQSA2IWWYOI4RYC7YHXXSKZCQ3L"),
  };

  const mockTx = { build: () => ({ toXDR: () => "mock-xdr", sign: vi.fn() }) };

  return {
    ...actual,
    Contract: vi.fn().mockImplementation(() => ({
      call: vi.fn().mockReturnValue({ toXDR: () => "mock-op" }),
    })),
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
        publicKey: vi.fn().mockReturnValue("GDQYHAWYCN4RCNXYZABCD2ABCD2ABCD2ABCD2ABCD2ABCD2ABCD2ABCD"),
      })),
    },
    hash: actual.hash,
    xdr: actual.xdr,
  };
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let validWasmPath: string;
let emptyWasmPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-test-"));
  validWasmPath = path.join(tmpDir, "token.wasm");
  fs.writeFileSync(validWasmPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  emptyWasmPath = path.join(tmpDir, "empty.wasm");
  fs.writeFileSync(emptyWasmPath, "");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("Upgrade Command (#703, #706)", () => {
  const baseOpts = () => ({
    wasmPath: validWasmPath,
    contractId: MOCK_CONTRACT_ID,
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: MOCK_NETWORK_PASSPHRASE,
    source: MOCK_SOURCE_SECRET,
    dryRun: false,
  });

  describe("input validation", () => {
    it("rejects when WASM file does not exist", async () => {
      const opts = baseOpts();
      opts.wasmPath = "/nonexistent/path.wasm";
      const result = await runUpgrade(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("rejects when WASM file is empty", async () => {
      const opts = baseOpts();
      opts.wasmPath = emptyWasmPath;
      const result = await runUpgrade(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("empty");
    });
  });

  describe("dry-run mode", () => {
    it("succeeds with valid WASM in dry-run mode", async () => {
      const opts = baseOpts();
      opts.dryRun = true;
      const result = await runUpgrade(opts);
      expect(result.success).toBe(true);
      expect(result.wasmHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.message).toContain("Dry-run");
    });
  });

  describe("fee estimation", () => {
    it("returns fee estimate with --estimate flag", async () => {
      const opts = baseOpts();
      opts.estimate = true;
      const result = await runUpgrade(opts);
      expect(result.success).toBe(true);
      expect(result.wasmHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.estimate).toBeDefined();
      expect(result.estimate!.baseFee).toBe("100");
      expect(result.estimate!.resourceFee).toBe("200000");
      expect(result.estimate!.totalFee).toBe("200100");
      expect(result.message).toContain("Fee estimate");
      expect(result.message).toContain("200100");
    });

    it("does not submit transaction when --estimate is set", async () => {
      const opts = baseOpts();
      opts.estimate = true;
      const result = await runUpgrade(opts);
      expect(result.success).toBe(true);
      expect(result.txHash).toBeUndefined();
    });

    it("reports simulation failure when --estimate is set", async () => {
      const opts = baseOpts();
      opts.estimate = true;

      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        () =>
          createMockServer({ simulationError: "budget exceeded" }) as any
      );

      const result = await runUpgrade(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Simulation failed");
      expect(result.message).toContain("budget exceeded");
    });

    it("does not submit when --estimate and --dry-run are both set", async () => {
      const opts = baseOpts();
      opts.estimate = true;
      opts.dryRun = true;
      const result = await runUpgrade(opts);
      expect(result.success).toBe(true);
      expect(result.estimate).toBeDefined();
      expect(result.txHash).toBeUndefined();
    });
  });

  describe("on-chain submission", () => {
    it("submits upgrade transaction and returns hash", async () => {
      const opts = baseOpts();
      opts.dryRun = false;
      const result = await runUpgrade(opts);
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
      expect(result.wasmHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.message).toContain("Upgrade transaction submitted");
    });

    it("signs the assembled transaction before submitting it (#708)", async () => {
      const opts = baseOpts();
      opts.dryRun = false;
      const result = await runUpgrade(opts);
      const { TransactionBuilder } = await import("@stellar/stellar-sdk");
      // mocks aren't cleared between tests, so take only this call's (last) TransactionBuilder instance.
      const results = vi.mocked(TransactionBuilder).mock.results;
      const builtTx = results[results.length - 1].value.build();
      expect(result.success).toBe(true);
      expect(builtTx.sign).toHaveBeenCalled();
    });

    it("fails without submitting when simulation/fee assembly fails (#708)", async () => {
      const opts = baseOpts();
      opts.dryRun = false;

      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        () => createMockServer({ simulationError: "resource limit exceeded" }) as any
      );

      const result = await runUpgrade(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Simulation failed");
      expect(result.message).toContain("resource limit exceeded");
    });

    it("tolerates real confirmation latency by polling past transient NOT_FOUND status (#708)", async () => {
      const opts = baseOpts();
      opts.dryRun = false;

      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        () => createMockServer({ pendingPollsBeforeSuccess: 2 }) as any
      );

      const result = await runUpgrade(opts);
      expect(result.success).toBe(true);
      expect(result.txHash).toBeDefined();
    });

    it("reports a timeout instead of hanging when confirmation never arrives within the budget (#708)", async () => {
      const opts = baseOpts();
      opts.dryRun = false;
      opts.timeout = "5";

      const { rpc: SorobanRpcNs } = await import("@stellar/stellar-sdk");
      vi.mocked(SorobanRpcNs.Server).mockImplementationOnce(
        () => createMockServer({ pendingPollsBeforeSuccess: 1000 }) as any
      );

      const result = await runUpgrade(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Timed out");
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
      const result = await runUpgrade(opts);
      expect(result.success).toBe(false);
      expect(result.message).toContain("Upgrade error");
    });
  });
});
