// SPDX-License-Identifier: MIT
import { describe, it, expect, vi } from "vitest";
import { deployVault } from "../commands/deploy.js";

vi.mock("node:fs", async (orig) => ({
  ...(await orig<typeof import("node:fs")>()),
  existsSync: vi.fn(() => true),
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
import {
  checkMainnetAdmin,
  MAINNET_PASSPHRASE,
  SINGLE_SIGNER_WARNING,
  fetchAccountSignersFromHorizon,
} from "../utils/mainnet-guard.js";

const ADMIN = "GABC";
const single = async () => ({ signerCount: 1, medThreshold: 1 });
const multi = async () => ({ signerCount: 3, medThreshold: 2 });

describe("checkMainnetAdmin", () => {
  it("does not block testnet", async () => {
    const fetchAccount = vi.fn(single);
    const r = await checkMainnetAdmin({
      networkPassphrase: "Test SDF Network ; September 2015",
      admin: ADMIN,
      fetchAccount,
    });
    expect(r.allowed).toBe(true);
    expect(fetchAccount).not.toHaveBeenCalled();
  });

  it("blocks mainnet single signer in non-interactive mode", async () => {
    const warn = vi.fn();
    const r = await checkMainnetAdmin({
      networkPassphrase: MAINNET_PASSPHRASE,
      admin: ADMIN,
      fetchAccount: single,
      interactive: false,
      warn,
    });
    expect(r.allowed).toBe(false);
    expect(warn).toHaveBeenCalledWith(SINGLE_SIGNER_WARNING);
  });

  it("allows with force flag and warns", async () => {
    const warn = vi.fn();
    const r = await checkMainnetAdmin({
      networkPassphrase: MAINNET_PASSPHRASE,
      admin: ADMIN,
      fetchAccount: single,
      forceSingleSigner: true,
      warn,
    });
    expect(r.allowed).toBe(true);
    expect(warn).toHaveBeenCalledWith(SINGLE_SIGNER_WARNING);
  });

  it("honours interactive confirmation", async () => {
    const base = {
      networkPassphrase: MAINNET_PASSPHRASE,
      admin: ADMIN,
      fetchAccount: single,
      interactive: true,
      warn: vi.fn(),
    };
    expect((await checkMainnetAdmin({ ...base, confirm: async () => true })).allowed).toBe(true);
    expect((await checkMainnetAdmin({ ...base, confirm: async () => false })).allowed).toBe(false);
  });

  it("allows multisig and contract admins on mainnet", async () => {
    expect(
      (await checkMainnetAdmin({ networkPassphrase: MAINNET_PASSPHRASE, admin: ADMIN, fetchAccount: multi })).allowed
    ).toBe(true);
    expect(
      (await checkMainnetAdmin({ networkPassphrase: MAINNET_PASSPHRASE, admin: "CABC", fetchAccount: single })).allowed
    ).toBe(true);
  });
});

describe("fetchAccountSignersFromHorizon", () => {
  it("parses signers and thresholds", async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({ signers: [{ weight: 1 }, { weight: 0 }], thresholds: { med_threshold: 1 } }),
    })) as unknown as typeof fetch;
    expect(await fetchAccountSignersFromHorizon(ADMIN, "http://h", f)).toEqual({ signerCount: 1, medThreshold: 1 });
  });
  it("throws on HTTP error", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(fetchAccountSignersFromHorizon(ADMIN, "http://h", f)).rejects.toThrow(/404/);
  });
});

describe("deployVault mainnet guard", () => {
  const opts = {
    vaultWasm: "/tmp/v.wasm",
    admin: ADMIN,
    source: "S",
    underlyingToken: "CTOK",
    name: "n",
    symbol: "s",
    rpcUrl: "http://rpc",
    networkPassphrase: MAINNET_PASSPHRASE,
    network: "mainnet",
  };
  it("blocks single-signer admin before any deploy step", async () => {
    const r = await deployVault({
      ...opts,
      mainnetGuard: { fetchAccount: single, interactive: false, warn: vi.fn() },
    });
    expect(r.success).toBe(false);
    expect(r.steps).toHaveLength(0);
    expect(r.message).toMatch(/single-signer/);
  });
});
