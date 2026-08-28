import type { Keypair } from "@stellar/stellar-sdk";

/**
 * Minimal surface of `SorobanRpc.Server` needed to prepare, sign, submit, and
 * confirm a contract-invoking transaction. Kept narrow so tests can supply a
 * lightweight mock instead of a real RPC client.
 */
export interface SorobanSubmitServer {
  prepareTransaction(tx: any): Promise<any>;
  sendTransaction(tx: any): Promise<{ status: string; hash: string; errorResult?: unknown }>;
  getTransaction(hash: string): Promise<{ status: string }>;
}

export interface PrepareSignSubmitOptions {
  /** Interval between confirmation polls, in ms. Default 1000. */
  pollIntervalMs?: number;
  /** Absolute `Date.now()`-based deadline; polling stops once reached. */
  deadline: number;
}

export type PrepareSignSubmitResult =
  | { outcome: "simulation_failed"; error: string }
  | { outcome: "submission_failed"; hash?: string; error: string }
  | { outcome: "confirmed"; hash: string }
  | { outcome: "failed_on_ledger"; hash: string }
  | { outcome: "timed_out"; hash: string; lastStatus: string };

/**
 * Simulates a raw transaction to attach the resource fee and footprint Soroban
 * requires, signs the assembled transaction, submits it, and polls until the
 * network reaches a terminal status or `deadline` passes.
 *
 * A hand-built `fee: "100"` and an unsigned transaction only ever "work"
 * against mocks: real Soroban RPC nodes reject unsigned submissions and
 * reject invocations whose fee doesn't cover the simulated resource cost.
 */
export async function prepareSignAndSubmit(
  server: SorobanSubmitServer,
  tx: any,
  signer: Keypair,
  opts: PrepareSignSubmitOptions
): Promise<PrepareSignSubmitResult> {
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (err) {
    return {
      outcome: "simulation_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  prepared.sign(signer);

  const sendResult = await server.sendTransaction(prepared);
  if (sendResult.status === "ERROR") {
    return {
      outcome: "submission_failed",
      hash: sendResult.hash,
      error: JSON.stringify(sendResult.errorResult),
    };
  }

  return pollForConfirmation(server, sendResult.hash, opts);
}

/**
 * Polls `getTransaction` until the network reports a terminal status
 * (SUCCESS/FAILED) or `deadline` passes. Real testnet confirmation typically
 * takes several ledgers (~5-15s), unlike the instant status a mock returns.
 */
export async function pollForConfirmation(
  server: Pick<SorobanSubmitServer, "getTransaction">,
  hash: string,
  opts: PrepareSignSubmitOptions
): Promise<PrepareSignSubmitResult> {
  const pollIntervalMs = opts.pollIntervalMs ?? 1000;

  for (;;) {
    const response = await server.getTransaction(hash);

    if (response.status === "SUCCESS") {
      return { outcome: "confirmed", hash };
    }
    if (response.status === "FAILED") {
      return { outcome: "failed_on_ledger", hash };
    }

    if (Date.now() >= opts.deadline) {
      return { outcome: "timed_out", hash, lastStatus: response.status };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
