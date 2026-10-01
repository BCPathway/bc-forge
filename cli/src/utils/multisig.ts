// SPDX-License-Identifier: MIT
/**
 * Admin multisig ceremony for `bc-forge multisig propose|approve|execute`.
 *
 * The CLI commands map onto the admin contract functions that actually
 * install a WASM upgrade:
 *
 *   propose -> create_proposal
 *   approve -> approve_proposal
 *   execute -> execute_upgrade
 *
 * Signing sources, in precedence order:
 *
 *   1. `--signature-file` — submit a pre-signed envelope;
 *   2. `--offline` — write unsigned XDR and do not submit;
 *   3. `--source` — a hot secret key.
 */

import * as fs from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import type { TransactionResult } from "@bc-forge/sdk";

/** The subset of `bcForgeClient` the multisig commands use. */
export interface MultisigClient {
  createProposal(
    creator: string,
    description: string,
    source?: Keypair
  ): Promise<TransactionResult>;
  approveProposal(
    admin: string,
    proposalId: bigint,
    source?: Keypair
  ): Promise<TransactionResult>;
  executeUpgrade(
    executor: string,
    proposalId: bigint,
    wasmHash: string,
    source?: Keypair
  ): Promise<TransactionResult>;
  buildCreateProposalTx(
    creator: string,
    description: string,
    sourcePublicKey: string
  ): Promise<string>;
  buildApproveProposalTx(
    admin: string,
    proposalId: bigint,
    sourcePublicKey: string
  ): Promise<string>;
  buildExecuteUpgradeTx(
    executor: string,
    proposalId: bigint,
    wasmHash: string,
    sourcePublicKey: string
  ): Promise<string>;
  submitSignedTransaction(txXdr: string): Promise<TransactionResult>;
  /** Submit a pre-signed `execute_upgrade` envelope. */
  execute(signedXdr: string): Promise<TransactionResult>;
}

export type MultisigAction = "propose" | "approve" | "execute";

export interface MultisigRunOptions {
  action: MultisigAction;
  client: MultisigClient;
  description?: string;
  proposalId?: string;
  wasmHash?: string;
  offline?: boolean;
  outFile?: string;
  signatureFile?: string;
  publicKey?: string;
  secretKey?: string;
  readFile?: (path: string) => string;
  writeFile?: (path: string, contents: string) => void;
}

export interface MultisigRunResult {
  action: MultisigAction;
  submitted: boolean;
  proposalId?: bigint;
  hash?: string;
  xdr?: string;
}

/**
 * Runs one step of the admin upgrade ceremony against an injected SDK client.
 */
export async function runMultisigCommand(
  options: MultisigRunOptions
): Promise<MultisigRunResult> {
  const { action, client } = options;

  if (options.offline && options.signatureFile) {
    throw new Error("Pass either --offline or --signature-file, not both.");
  }

  if (options.signatureFile) {
    const readFile = options.readFile ?? ((path: string) => fs.readFileSync(path, "utf8"));
    const signedXdr = readFile(options.signatureFile).trim();
    if (!signedXdr) {
      throw new Error(`Signature file ${options.signatureFile} is empty`);
    }

    if (action === "execute") {
      const result = await client.execute(signedXdr);
      assertSuccess(result, "execute_upgrade");
      return { action, submitted: true, hash: result.hash };
    }

    const result = await client.submitSignedTransaction(signedXdr);
    assertSuccess(result, action === "propose" ? "create_proposal" : "approve_proposal");
    return {
      action,
      submitted: true,
      hash: result.hash,
      proposalId: action === "propose" ? readProposalId(result) : undefined,
    };
  }

  if (options.offline) {
    if (!options.publicKey) {
      throw new Error("--public-key is required with --offline");
    }
    if (!options.outFile) {
      throw new Error("--out <file> is required with --offline");
    }

    const xdr = await buildUnsigned(options, options.publicKey);
    const writeFile =
      options.writeFile ??
      ((path: string, contents: string) => fs.writeFileSync(path, contents));
    writeFile(options.outFile, xdr);
    return { action, submitted: false, xdr };
  }

  const secretKey = options.secretKey;
  if (!secretKey) {
    throw new Error(
      "No signing source: pass --signature-file <signed.xdr>, --offline, or --source <secret>."
    );
  }

  const source = Keypair.fromSecret(secretKey);
  const signer = source.publicKey();

  if (action === "propose") {
    const description = requireDescription(options.description);
    const result = await client.createProposal(signer, description, source);
    assertSuccess(result, "create_proposal");
    return {
      action,
      submitted: true,
      hash: result.hash,
      proposalId: readProposalId(result),
    };
  }

  if (action === "approve") {
    const proposalId = requireProposalId(options.proposalId);
    const result = await client.approveProposal(signer, proposalId, source);
    assertSuccess(result, "approve_proposal");
    return { action, submitted: true, hash: result.hash, proposalId };
  }

  const proposalId = requireProposalId(options.proposalId);
  const wasmHash = requireWasmHash(options.wasmHash);
  const result = await client.executeUpgrade(signer, proposalId, wasmHash, source);
  assertSuccess(result, "execute_upgrade");
  return { action, submitted: true, hash: result.hash, proposalId };
}

async function buildUnsigned(options: MultisigRunOptions, publicKey: string): Promise<string> {
  const { action, client } = options;
  if (action === "propose") {
    return client.buildCreateProposalTx(publicKey, requireDescription(options.description), publicKey);
  }
  if (action === "approve") {
    return client.buildApproveProposalTx(publicKey, requireProposalId(options.proposalId), publicKey);
  }
  return client.buildExecuteUpgradeTx(
    publicKey,
    requireProposalId(options.proposalId),
    requireWasmHash(options.wasmHash),
    publicKey
  );
}

function requireDescription(description: string | undefined): string {
  const text = description?.trim() ?? "";
  if (!text) {
    throw new Error("--description <text> is required to propose");
  }
  return text;
}

function requireProposalId(raw: string | undefined): bigint {
  const text = raw?.trim() ?? "";
  if (!/^(0|[1-9]\d*)$/.test(text)) {
    throw new Error("--proposal-id <id> is required and must be a non-negative integer");
  }
  return BigInt(text);
}

function requireWasmHash(raw: string | undefined): string {
  const hex = (raw ?? "").trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error("--wasm-hash <hex> must be 32 bytes (64 hex characters)");
  }
  return hex;
}

function readProposalId(result: TransactionResult): bigint {
  const value = result.returnValue;
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error("create_proposal succeeded but did not return a proposal id");
}

function assertSuccess(result: TransactionResult, label: string): void {
  if (!result.success) {
    throw new Error(`${label} failed (tx ${result.hash})`);
  }
}
