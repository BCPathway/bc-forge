import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockServer,
  MOCK_SOURCE_SECRET,
  MOCK_CONTRACT_ID,
  MOCK_RPC_URL,
  MOCK_NETWORK_PASSPHRASE,
} from "./mocks.js";
import { runUpgrade } from "../commands/upgrade.js";
import {
  appendUpgradeHistory,
  getLastGoodHash,
  readHistoryFile,
  resolveHistoryPath,
} from "../utils/upgrade-history.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

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
    },
    hash: actual.hash,
    xdr: actual.xdr,
  };
});

// ─── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let validWasmPath: string;
let historyPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-history-test-"));
  validWasmPath = path.join(tmpDir, "token.wasm");
  fs.writeFileSync(validWasmPath, Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
  historyPath = path.join(tmpDir, "upgrade-history.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Unit tests for upgrade-history helpers ────────────────────────────────────

describe("upgrade-history helpers", () => {
  it("resolveHistoryPath returns default under home dir", () => {
    const resolved = resolveHistoryPath();
    expect(resolved).toContain(".bc-forge");
    expect(resolved).toContain("upgrade-history.json");
  });

  it("resolveHistoryPath prefers explicit argument over env var", () => {
    const prev = process.env.BC_FORGE_UPGRADE_HISTORY;
    process.env.BC_FORGE_UPGRADE_HISTORY = "/env/path.json";
    try {
      expect(resolveHistoryPath("/explicit/path.json")).toBe("/explicit/path.json");
    } finally {
      if (prev === undefined) {
        delete process.env.BC_FORGE_UPGRADE_HISTORY;
      } else {
        process.env.BC_FORGE_UPGRADE_HISTORY = prev;
      }
    }
  });

  it("resolveHistoryPath falls back to env var when no explicit path", () => {
    const prev = process.env.BC_FORGE_UPGRADE_HISTORY;
    process.env.BC_FORGE_UPGRADE_HISTORY = path.join(tmpDir, "from-env.json");
    try {
      expect(resolveHistoryPath()).toContain("from-env.json");
    } finally {
      if (prev === undefined) {
        delete process.env.BC_FORGE_UPGRADE_HISTORY;
      } else {
        process.env.BC_FORGE_UPGRADE_HISTORY = prev;
      }
    }
  });

  it("readHistoryFile returns empty object for missing file", () => {
    const result = readHistoryFile(path.join(tmpDir, "nonexistent.json"));
    expect(result).toEqual({});
  });

  it("readHistoryFile returns empty object for malformed JSON", () => {
    const badPath = path.join(tmpDir, "bad.json");
    fs.writeFileSync(badPath, "not-json");
    expect(readHistoryFile(badPath)).toEqual({});
  });

  it("appendUpgradeHistory creates file and appends entries", () => {
    appendUpgradeHistory(MOCK_CONTRACT_ID, "prev-hash", "new-hash", "tx-abc", historyPath);
    const data = readHistoryFile(historyPath);
    expect(data[MOCK_CONTRACT_ID]).toHaveLength(1);
    const entry = data[MOCK_CONTRACT_ID][0];
    expect(entry.previousHash).toBe("prev-hash");
    expect(entry.newHash).toBe("new-hash");
    expect(entry.txHash).toBe("tx-abc");
    expect(typeof entry.recordedAt).toBe("string");
  });

  it("appendUpgradeHistory accumulates multiple entries in order", () => {
    appendUpgradeHistory(MOCK_CONTRACT_ID, "hash-0", "hash-1", undefined, historyPath);
    appendUpgradeHistory(MOCK_CONTRACT_ID, "hash-1", "hash-2", undefined, historyPath);
    appendUpgradeHistory(MOCK_CONTRACT_ID, "hash-2", "hash-3", undefined, historyPath);

    const data = readHistoryFile(historyPath);
    const entries = data[MOCK_CONTRACT_ID];
    expect(entries).toHaveLength(3);
    expect(entries[0].newHash).toBe("hash-1");
    expect(entries[2].newHash).toBe("hash-3");
  });

  it("getLastGoodHash returns null when no history exists", () => {
    expect(getLastGoodHash(MOCK_CONTRACT_ID, historyPath)).toBeNull();
  });

  it("getLastGoodHash returns the previousHash from the latest entry", () => {
    appendUpgradeHistory(MOCK_CONTRACT_ID, "hash-a", "hash-b", undefined, historyPath);
    appendUpgradeHistory(MOCK_CONTRACT_ID, "hash-b", "hash-c", undefined, historyPath);
    expect(getLastGoodHash(MOCK_CONTRACT_ID, historyPath)).toBe("hash-b");
  });

  it("entries for different contracts are stored independently", () => {
    const other = "COTHER000000000000000000000000000000000000000000000000000000";
    appendUpgradeHistory(MOCK_CONTRACT_ID, "p1", "n1", undefined, historyPath);
    appendUpgradeHistory(other, "p2", "n2", undefined, historyPath);

    expect(getLastGoodHash(MOCK_CONTRACT_ID, historyPath)).toBe("p1");
    expect(getLastGoodHash(other, historyPath)).toBe("p2");
  });
});

// ─── Integration tests — runUpgrade records history ────────────────────────────

describe("runUpgrade history recording", () => {
  const baseOpts = () => ({
    wasmPath: validWasmPath,
    contractId: MOCK_CONTRACT_ID,
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: MOCK_NETWORK_PASSPHRASE,
    source: MOCK_SOURCE_SECRET,
    dryRun: false,
    historyPath,
  });

  it("records previousHash and newHash after a confirmed on-chain upgrade", async () => {
    const result = await runUpgrade(baseOpts());
    expect(result.success).toBe(true);

    const data = readHistoryFile(historyPath);
    const entries = data[MOCK_CONTRACT_ID];
    expect(entries).toBeDefined();
    expect(entries.length).toBeGreaterThan(0);

    const entry = entries[0];
    expect(typeof entry.newHash).toBe("string");
    expect(entry.newHash).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof entry.previousHash).toBe("string");
    expect(entry.txHash).toBeDefined();
  });

  it("does NOT record history in dry-run mode", async () => {
    const result = await runUpgrade({ ...baseOpts(), dryRun: true });
    expect(result.success).toBe(true);
    expect(readHistoryFile(historyPath)[MOCK_CONTRACT_ID]).toBeUndefined();
  });

  it("does NOT record history in estimate mode", async () => {
    const result = await runUpgrade({ ...baseOpts(), estimate: true });
    expect(result.success).toBe(true);
    expect(readHistoryFile(historyPath)[MOCK_CONTRACT_ID]).toBeUndefined();
  });
});

// ─── Integration tests — --to-last-good ────────────────────────────────────────

describe("runUpgrade --to-last-good", () => {
  const baseOpts = () => ({
    wasmPath: validWasmPath,
    contractId: MOCK_CONTRACT_ID,
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: MOCK_NETWORK_PASSPHRASE,
    source: MOCK_SOURCE_SECRET,
    dryRun: false,
    historyPath,
  });

  it("fails clearly when no history exists for the contract", async () => {
    const result = await runUpgrade({ ...baseOpts(), toLastGood: true });
    expect(result.success).toBe(false);
    expect(result.message).toContain("No upgrade history found");
    expect(result.message).toContain(MOCK_CONTRACT_ID);
  });

  it("succeeds and proposes the previous hash when history exists", async () => {
    // Seed a known previous hash in the history file.
    appendUpgradeHistory(
      MOCK_CONTRACT_ID,
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "tx-seed",
      historyPath,
    );

    const result = await runUpgrade({ ...baseOpts(), toLastGood: true });
    expect(result.success).toBe(true);
    // The wasmHash in the result should be the previousHash we seeded.
    expect(result.wasmHash).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(result.message).toContain("rollback");
  });

  it("dry-run with --to-last-good simulates without submitting", async () => {
    appendUpgradeHistory(
      MOCK_CONTRACT_ID,
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      undefined,
      historyPath,
    );

    const result = await runUpgrade({ ...baseOpts(), toLastGood: true, dryRun: true });
    expect(result.success).toBe(true);
    expect(result.txHash).toBeUndefined();
    expect(result.message).toContain("Dry-run");
    expect(result.message).toContain("rollback");
  });

  it("uses the most recent entry when multiple upgrades have been recorded", async () => {
    appendUpgradeHistory(MOCK_CONTRACT_ID, "first-prev", "first-new", undefined, historyPath);
    appendUpgradeHistory(MOCK_CONTRACT_ID, "second-prev", "second-new", undefined, historyPath);

    // getLastGoodHash returns the previousHash of the LAST entry.
    expect(getLastGoodHash(MOCK_CONTRACT_ID, historyPath)).toBe("second-prev");

    const result = await runUpgrade({ ...baseOpts(), toLastGood: true });
    expect(result.success).toBe(true);
    expect(result.wasmHash).toBe("second-prev");
  });
});
