// SPDX-License-Identifier: MIT
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createMockServer,
  MOCK_SOURCE_SECRET,
  MOCK_CONTRACT_ID,
  MOCK_RPC_URL,
  MOCK_NETWORK_PASSPHRASE,
} from "../../__tests__/mocks.js";
import { runUpgrade, STORAGE_CHECK_GETTERS } from "../upgrade.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let server: any;
let calls: string[];

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    Contract: vi.fn(function () {
      return {
        call: vi.fn((name: string) => ({ __method: name })),
      };
    }),
    TransactionBuilder: vi.fn(function () {
      let op: any;
      return {
        addOperation: vi.fn(function (o: any) {
          op = o;
          return this;
        }),
        setTimeout: vi.fn().mockReturnThis(),
        build: vi.fn(() => ({
          __method: op?.__method,
          toXDR: () => "mock-xdr",
          sign: vi.fn(),
        })),
      };
    }),
    rpc: {
      ...actual.rpc,
      Server: vi.fn(function () {
        return server;
      }),
    },
    Keypair: {
      ...actual.Keypair,
      fromSecret: vi.fn(() => ({
        publicKey: vi
          .fn()
          .mockReturnValue(
            "GBZCSTYJGKFBXQ7YXKCZC25S5XEHFPQSA2IWWYOI4RYC7YHXXSKZCQ3L",
          ),
      })),
    },
  };
});

let tmpDir: string;
let wasmPath: string;

beforeEach(async () => {
  const { xdr } = await import("@stellar/stellar-sdk");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-sim-"));
  wasmPath = path.join(tmpDir, "token.wasm");
  fs.writeFileSync(
    wasmPath,
    Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
  );
  calls = [];
  server = createMockServer();
  server.simulateTransaction = vi.fn(async (tx: any) => {
    calls.push(tx.__method);
    return {
      result: { retval: xdr.ScVal.scvU32(7) },
      minResourceFee: "100",
      events: [],
      id: "0",
      latestLedger: 1,
      _parsed: true,
    };
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const opts = () => ({
  wasmPath,
  contractId: MOCK_CONTRACT_ID,
  rpcUrl: MOCK_RPC_URL,
  networkPassphrase: MOCK_NETWORK_PASSPHRASE,
  source: MOCK_SOURCE_SECRET,
  simulate: true,
});

describe("upgrade --simulate storage compatibility check", () => {
  it("passes when every core getter returns a decodable ScVal, and never submits", async () => {
    const result = await runUpgrade(opts());
    expect(result.success).toBe(true);
    expect(result.storageCheck?.ok).toBe(true);
    expect(result.storageCheck?.results.map((r) => r.getter)).toEqual([
      ...STORAGE_CHECK_GETTERS,
    ]);
    expect(calls).toContain("upgrade");
    for (const g of [
      "name",
      "symbol",
      "decimals",
      "total_supply",
      "get_storage_info",
    ]) {
      expect(calls).toContain(g);
    }
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("fails with a per-getter diagnostic when a getter reverts (incompatible upgrade)", async () => {
    const original = server.simulateTransaction;
    server.simulateTransaction = vi.fn(async (tx: any) => {
      if (tx.__method === "total_supply") {
        calls.push(tx.__method);
        return {
          error: "HostError: storage key missing",
          events: [],
          id: "0",
          latestLedger: 1,
        };
      }
      return original(tx);
    });
    const result = await runUpgrade(opts());
    expect(result.success).toBe(false);
    expect(result.message).toContain("total_supply()");
    expect(result.message).toContain("storage key missing");
    expect(result.storageCheck?.ok).toBe(false);
    expect(result.storageCheck?.results.filter((r) => !r.ok)).toHaveLength(1);
    expect(server.sendTransaction).not.toHaveBeenCalled();
  });

  it("fails when a getter returns no value", async () => {
    server.simulateTransaction = vi.fn(async (tx: any) => ({
      result: tx.__method === "name" ? undefined : { retval: undefined },
      events: [],
    }));
    const result = await runUpgrade(opts());
    expect(result.success).toBe(false);
    expect(result.message).toContain("returned no value");
  });

  it("fails when the upgrade simulation itself errors", async () => {
    server.simulateTransaction = vi.fn(async () => ({
      error: "bad wasm",
      events: [],
    }));
    const result = await runUpgrade(opts());
    expect(result.success).toBe(false);
    expect(result.message).toContain("Upgrade simulation failed");
  });
});
