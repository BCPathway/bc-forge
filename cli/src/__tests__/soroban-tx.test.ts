import { describe, it, expect, vi } from "vitest";
import {
  prepareSignAndSubmit,
  pollForConfirmation,
  type SorobanSubmitServer,
} from "../utils/soroban-tx.js";

function createServer(overrides: Partial<SorobanSubmitServer> = {}): SorobanSubmitServer {
  return {
    prepareTransaction: vi.fn(async (tx: any) => tx),
    sendTransaction: vi.fn(async () => ({ status: "PENDING", hash: "hash1" })),
    getTransaction: vi.fn(async (hash: string) => ({ status: "SUCCESS", hash })),
    ...overrides,
  };
}

function fakeTx() {
  return { sign: vi.fn() };
}

const signer = {} as any;

describe("prepareSignAndSubmit (#708)", () => {
  it("simulates, assembles fee/footprint, signs, submits, and confirms on the happy path", async () => {
    const tx = fakeTx();
    const server = createServer();

    const result = await prepareSignAndSubmit(server, tx, signer, { deadline: Date.now() + 5000 });

    expect(server.prepareTransaction).toHaveBeenCalledWith(tx);
    expect(tx.sign).toHaveBeenCalledWith(signer);
    expect(server.sendTransaction).toHaveBeenCalledWith(tx);
    expect(result).toEqual({ outcome: "confirmed", hash: "hash1" });
  });

  it("never signs or submits an unsigned transaction when simulation fails", async () => {
    const tx = fakeTx();
    const server = createServer({
      prepareTransaction: vi.fn(async () => {
        throw new Error("simulation host error: budget exceeded");
      }),
    });

    const result = await prepareSignAndSubmit(server, tx, signer, { deadline: Date.now() + 5000 });

    expect(tx.sign).not.toHaveBeenCalled();
    expect(server.sendTransaction).not.toHaveBeenCalled();
    expect(result).toEqual({
      outcome: "simulation_failed",
      error: "simulation host error: budget exceeded",
    });
  });

  it("reports submission_failed when the RPC rejects the signed transaction", async () => {
    const tx = fakeTx();
    const server = createServer({
      sendTransaction: vi.fn(async () => ({
        status: "ERROR",
        hash: "hash1",
        errorResult: { code: "txInsufficientFee" },
      })),
    });

    const result = await prepareSignAndSubmit(server, tx, signer, { deadline: Date.now() + 5000 });

    expect(result.outcome).toBe("submission_failed");
    expect((result as any).error).toContain("txInsufficientFee");
  });
});

describe("pollForConfirmation — real network latency (#708)", () => {
  it("polls past transient NOT_FOUND responses until the network reports SUCCESS", async () => {
    let calls = 0;
    const server = {
      getTransaction: vi.fn(async (hash: string) => {
        calls++;
        if (calls < 3) return { status: "NOT_FOUND", hash };
        return { status: "SUCCESS", hash };
      }),
    };

    const result = await pollForConfirmation(server, "hash1", {
      deadline: Date.now() + 5000,
      pollIntervalMs: 1,
    });

    expect(calls).toBe(3);
    expect(result).toEqual({ outcome: "confirmed", hash: "hash1" });
  });

  it("reports failed_on_ledger when the network settles on FAILED", async () => {
    const server = {
      getTransaction: vi.fn(async (hash: string) => ({ status: "FAILED", hash })),
    };

    const result = await pollForConfirmation(server, "hash1", { deadline: Date.now() + 5000 });

    expect(result).toEqual({ outcome: "failed_on_ledger", hash: "hash1" });
  });

  it("times out rather than polling forever when confirmation never arrives", async () => {
    const server = {
      getTransaction: vi.fn(async (hash: string) => ({ status: "NOT_FOUND", hash })),
    };

    const result = await pollForConfirmation(server, "hash1", {
      deadline: Date.now() - 1,
      pollIntervalMs: 1,
    });

    expect(result).toEqual({ outcome: "timed_out", hash: "hash1", lastStatus: "NOT_FOUND" });
  });
});
