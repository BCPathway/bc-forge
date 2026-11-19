// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { StrKey, xdr, Address } from "@stellar/stellar-sdk";
import {
  hashLocalWasm,
  extractOnChainHash,
  fetchOnChainHash,
  verifyHash,
  type HashFetcher,
} from "../commands/verify-hash.js";

const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

/** Builds a contract instance ledger entry referencing `wasmHash`. */
function extensionPoint(): xdr.ExtensionPoint {
  return typeof xdr.ExtensionPoint.v0 === "function"
    ? xdr.ExtensionPoint.v0()
    : new (xdr.ExtensionPoint as any)(0);
}

function instanceEntry(wasmHash: Buffer): xdr.LedgerEntryData {
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash),
    storage: null,
  });

  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: extensionPoint(),
      contract: new Address(CONTRACT_ID).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val: xdr.ScVal.scvContractInstance(instance),
    }),
  );
}

/** Builds a Stellar-asset contract instance entry, which carries no WASM hash. */
function assetInstanceEntry(): xdr.LedgerEntryData {
  const instance = new xdr.ScContractInstance({
    executable: xdr.ContractExecutable.contractExecutableStellarAsset(),
    storage: null,
  });

  return xdr.LedgerEntryData.contractData(
    new xdr.ContractDataEntry({
      ext: extensionPoint(),
      contract: new Address(CONTRACT_ID).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent,
      val: xdr.ScVal.scvContractInstance(instance),
    }),
  );
}

function stubServer(entries: unknown[]): HashFetcher {
  return {
    getLedgerEntries: vi.fn(async () => ({ entries })) as any,
  } as HashFetcher;
}

describe("CLI verify-hash command (#700)", () => {
  let tmpDir: string;
  let wasmPath: string;
  let wasmBytes: Buffer;
  let expectedHash: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-hash-"));
    wasmPath = path.join(tmpDir, "bc_forge_token.wasm");
    wasmBytes = Buffer.from(
      "0061736d010000002066616b6520636f6e747261637420626f6479",
      "hex",
    );
    fs.writeFileSync(wasmPath, wasmBytes);
    expectedHash = crypto.createHash("sha256").update(wasmBytes).digest("hex");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("hashLocalWasm", () => {
    it("computes the sha256 of the raw wasm bytes", () => {
      expect(hashLocalWasm(wasmPath)).toBe(expectedHash);
      expect(hashLocalWasm(wasmPath)).toHaveLength(64);
    });

    it("throws when the artifact does not exist", () => {
      expect(() => hashLocalWasm(path.join(tmpDir, "absent.wasm"))).toThrow();
    });
  });

  describe("extractOnChainHash", () => {
    it("reads the wasm hash out of a contract instance entry", () => {
      const hash = Buffer.alloc(32, 0xab);
      expect(extractOnChainHash(instanceEntry(hash))).toBe(
        hash.toString("hex"),
      );
    });

    it("returns undefined for a Stellar-asset contract with no uploaded wasm", () => {
      expect(extractOnChainHash(assetInstanceEntry())).toBeUndefined();
    });
  });

  describe("fetchOnChainHash", () => {
    it("returns the deployed wasm hash", async () => {
      const hash = Buffer.alloc(32, 0xcd);
      const server = stubServer([{ val: instanceEntry(hash) }]);

      expect(await fetchOnChainHash(server, CONTRACT_ID)).toBe(
        hash.toString("hex"),
      );
    });

    it("returns undefined when the contract is not deployed", async () => {
      expect(
        await fetchOnChainHash(stubServer([]), CONTRACT_ID),
      ).toBeUndefined();
    });

    it("rejects a malformed contract id before making a request", async () => {
      const server = stubServer([]);
      await expect(fetchOnChainHash(server, "NOT-A-CONTRACT")).rejects.toThrow(
        /Invalid contract ID/,
      );
      expect(server.getLedgerEntries).not.toHaveBeenCalled();
    });
  });

  describe("verifyHash", () => {
    it("reports a match when local and on-chain hashes are identical", async () => {
      const server = stubServer([
        { val: instanceEntry(Buffer.from(expectedHash, "hex")) },
      ]);

      const result = await verifyHash(server, "token", CONTRACT_ID, wasmPath);

      expect(result.verdict).toBe("match");
      expect(result.localHash).toBe(expectedHash);
      expect(result.onChainHash).toBe(expectedHash);
      expect(result.error).toBeUndefined();
    });

    it("reports a mismatch when the deployed contract runs different code", async () => {
      const server = stubServer([
        { val: instanceEntry(Buffer.alloc(32, 0xff)) },
      ]);

      const result = await verifyHash(server, "token", CONTRACT_ID, wasmPath);

      expect(result.verdict).toBe("mismatch");
      expect(result.localHash).toBe(expectedHash);
      expect(result.onChainHash).toBe("ff".repeat(32));
    });

    it("reports missing_local when the build artifact is absent", async () => {
      const server = stubServer([{ val: instanceEntry(Buffer.alloc(32, 1)) }]);

      const result = await verifyHash(
        server,
        "token",
        CONTRACT_ID,
        path.join(tmpDir, "absent.wasm"),
      );

      expect(result.verdict).toBe("missing_local");
      expect(result.error).toMatch(/Could not read local WASM/);
    });

    it("reports missing_onchain when the contract has no instance entry", async () => {
      const result = await verifyHash(
        stubServer([]),
        "token",
        CONTRACT_ID,
        wasmPath,
      );

      expect(result.verdict).toBe("missing_onchain");
      expect(result.localHash).toBe(expectedHash);
      expect(result.onChainHash).toBeUndefined();
    });

    it("reports invalid when no contract id is configured", async () => {
      const result = await verifyHash(
        stubServer([]),
        "token",
        undefined,
        wasmPath,
      );

      expect(result.verdict).toBe("invalid");
      expect(result.error).toMatch(/No contractId configured/);
    });

    it("reports invalid when no local wasm path is provided", async () => {
      const result = await verifyHash(
        stubServer([]),
        "token",
        CONTRACT_ID,
        undefined,
      );

      expect(result.verdict).toBe("invalid");
      expect(result.error).toMatch(/No local WASM path/);
    });

    it("reports invalid when the RPC lookup fails", async () => {
      const server = {
        getLedgerEntries: vi.fn(async () => {
          throw new Error("connect ECONNREFUSED");
        }) as any,
      } as HashFetcher;

      const result = await verifyHash(server, "token", CONTRACT_ID, wasmPath);

      expect(result.verdict).toBe("invalid");
      expect(result.error).toMatch(/ECONNREFUSED/);
      expect(result.localHash).toBe(expectedHash);
    });
  });
});
