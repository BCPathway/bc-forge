/**
 * Pauser tool — incident-response logic for `bc-forge pause` / `bc-forge unpause`.
 *
 * Kept free of commander, config, and network wiring so it can be unit tested
 * with a mocked client. Signing sources, in precedence order:
 *
 *   1. `--signature <file>` — submit a pre-signed transaction XDR (hardware
 *      wallet / offline signer);
 *   2. `--build-only` — build an unsigned transaction for an external signer;
 *   3. `--source <secret>` — a hot secret key (testnet / local only).
 *
 * No secret key is embedded in this file or the repository.
 */

import * as fs from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import type { TransactionResult } from "@bc-forge/sdk";

/** The subset of `bcForgeClient` the pauser tool uses. */
export interface PauseCapableClient {
  pause(source?: Keypair): Promise<TransactionResult>;
  unpause(source?: Keypair): Promise<TransactionResult>;
  buildPauseTx(sourcePublicKey: string): Promise<string>;
  buildUnpauseTx(sourcePublicKey: string): Promise<string>;
  submitSignedTransaction(txXdr: string): Promise<TransactionResult>;
}

export type PauseAction = "pause" | "unpause";

export interface PauseRunOptions {
  action: PauseAction;
  client: PauseCapableClient;
  /** Pre-signed transaction XDR to submit as-is. */
  signatureFile?: string;
  /** Build an unsigned transaction instead of signing and submitting. */
  buildOnly?: boolean;
  /** Where to write the unsigned XDR when `buildOnly` is set. Defaults to the log. */
  outFile?: string;
  /** Caller/source public key. Required for `buildOnly`. */
  publicKey?: string;
  /** Hot signer secret key. Testnet / local only. */
  secretKey?: string;
  /** Injectable I/O for tests. */
  readFile?: (path: string) => string;
  writeFile?: (path: string, contents: string) => void;
  log?: (message: string) => void;
}

export interface PauseRunResult {
  action: PauseAction;
  /** Whether a transaction was broadcast. */
  submitted: boolean;
  /** Transaction hash when a transaction was broadcast. */
  hash?: string;
  /** Unsigned XDR when `buildOnly` was used. */
  xdr?: string;
}

/**
 * Runs the pause/unpause flow against an injected client. Throws when no usable
 * signing source is provided.
 */
export async function runPauseCommand(
  options: PauseRunOptions
): Promise<PauseRunResult> {
  const { action, client } = options;

  if (options.signatureFile) {
    const readFile = options.readFile ?? ((path: string) => fs.readFileSync(path, "utf8"));
    const signedXdr = readFile(options.signatureFile).trim();
    if (!signedXdr) {
      throw new Error(`Signature file ${options.signatureFile} is empty`);
    }
    const result = await client.submitSignedTransaction(signedXdr);
    return { action, submitted: true, hash: result.hash };
  }

  if (options.buildOnly) {
    if (!options.publicKey) {
      throw new Error("--public-key is required with --build-only");
    }
    const xdr =
      action === "pause"
        ? await client.buildPauseTx(options.publicKey)
        : await client.buildUnpauseTx(options.publicKey);
    if (options.outFile) {
      const writeFile =
        options.writeFile ?? ((path: string, contents: string) => fs.writeFileSync(path, contents));
      writeFile(options.outFile, xdr);
    } else {
      const log = options.log ?? ((message: string) => console.log(message));
      log(xdr);
    }
    return { action, submitted: false, xdr };
  }

  const secretKey = options.secretKey;
  if (!secretKey) {
    throw new Error(
      "No signing source: pass --signature <signed.xdr>, --build-only, or --source <secret>."
    );
  }

  const source = Keypair.fromSecret(secretKey);
  const result = action === "pause" ? await client.pause(source) : await client.unpause(source);
  return { action, submitted: true, hash: result.hash };
}
