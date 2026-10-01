// SPDX-License-Identifier: MIT
import { describe, it, expect } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { buildProgram } from "../parseArgs.js";
import {
  runMultisigCommand,
  type MultisigClient,
} from "../utils/multisig.js";

const WASM_HASH = "ab".repeat(32);

function createMockSdkClient() {
  const calls = {
    createProposal: [] as string[],
    approveProposal: [] as string[],
    executeUpgrade: [] as string[],
    buildCreateProposalTx: [] as string[],
    buildApproveProposalTx: [] as string[],
    buildExecuteUpgradeTx: [] as string[],
    submit: [] as string[],
    execute: [] as string[],
  };

  const client: MultisigClient = {
    async createProposal(creator, description) {
      calls.createProposal.push(`${creator}:${description}`);
      return { success: true, hash: "hash-propose", returnValue: 42n };
    },
    async approveProposal(admin, proposalId) {
      calls.approveProposal.push(`${admin}:${proposalId.toString()}`);
      return { success: true, hash: "hash-approve" };
    },
    async executeUpgrade(executor, proposalId, wasmHash) {
      calls.executeUpgrade.push(`${executor}:${proposalId.toString()}:${wasmHash}`);
      return { success: true, hash: "hash-execute" };
    },
    async buildCreateProposalTx(creator, description, sourcePublicKey) {
      calls.buildCreateProposalTx.push(`${creator}:${description}:${sourcePublicKey}`);
      return "UNSIGNED_PROPOSE_XDR";
    },
    async buildApproveProposalTx(admin, proposalId, sourcePublicKey) {
      calls.buildApproveProposalTx.push(`${admin}:${proposalId.toString()}:${sourcePublicKey}`);
      return "UNSIGNED_APPROVE_XDR";
    },
    async buildExecuteUpgradeTx(executor, proposalId, wasmHash, sourcePublicKey) {
      calls.buildExecuteUpgradeTx.push(
        `${executor}:${proposalId.toString()}:${wasmHash}:${sourcePublicKey}`
      );
      return "UNSIGNED_EXECUTE_XDR";
    },
    async submitSignedTransaction(txXdr) {
      calls.submit.push(txXdr);
      return { success: true, hash: "hash-submit", returnValue: 7n };
    },
    async execute(signedXdr) {
      calls.execute.push(signedXdr);
      return { success: true, hash: "hash-execute-signed" };
    },
  };

  return { client, calls };
}

describe("multisig ceremony", () => {
  it("registers propose, approve, and execute", () => {
    const multisig = buildProgram().commands.find((cmd) => cmd.name() === "multisig");
    expect(multisig?.commands.map((cmd) => cmd.name())).toEqual([
      "propose",
      "approve",
      "execute",
    ]);
  });

  it("propose calls the SDK and returns a proposal id", async () => {
    const { client, calls } = createMockSdkClient();
    const signer = Keypair.random();

    const result = await runMultisigCommand({
      action: "propose",
      client,
      description: "Upgrade to v2.1.0",
      secretKey: signer.secret(),
    });

    expect(calls.createProposal).toEqual([`${signer.publicKey()}:Upgrade to v2.1.0`]);
    expect(calls.submit).toEqual([]);
    expect(result.submitted).toBe(true);
    expect(result.proposalId).toBe(42n);
    expect(result.hash).toBe("hash-propose");
  });

  it("approve and execute call the SDK", async () => {
    const { client, calls } = createMockSdkClient();
    const signer = Keypair.random();

    const approved = await runMultisigCommand({
      action: "approve",
      client,
      proposalId: "3",
      secretKey: signer.secret(),
    });
    const executed = await runMultisigCommand({
      action: "execute",
      client,
      proposalId: "3",
      wasmHash: WASM_HASH,
      secretKey: signer.secret(),
    });

    expect(calls.approveProposal).toEqual([`${signer.publicKey()}:3`]);
    expect(calls.executeUpgrade).toEqual([`${signer.publicKey()}:3:${WASM_HASH}`]);
    expect(approved.hash).toBe("hash-approve");
    expect(executed.hash).toBe("hash-execute");
    expect(executed.submitted).toBe(true);
  });

  it("offline mode writes XDR and does not submit", async () => {
    const { client, calls } = createMockSdkClient();
    const written: Record<string, string> = {};

    const proposed = await runMultisigCommand({
      action: "propose",
      client,
      description: "cold proposal",
      offline: true,
      publicKey: "GPROPOSER",
      outFile: "propose.unsigned.xdr",
      writeFile: (path, contents) => {
        written[path] = contents;
      },
    });
    const executed = await runMultisigCommand({
      action: "execute",
      client,
      proposalId: "9",
      wasmHash: `0x${WASM_HASH}`,
      offline: true,
      publicKey: "GEXECUTOR",
      outFile: "execute.unsigned.xdr",
      writeFile: (path, contents) => {
        written[path] = contents;
      },
    });

    expect(proposed.submitted).toBe(false);
    expect(proposed.xdr).toBe("UNSIGNED_PROPOSE_XDR");
    expect(executed.submitted).toBe(false);
    expect(written["propose.unsigned.xdr"]).toBe("UNSIGNED_PROPOSE_XDR");
    expect(written["execute.unsigned.xdr"]).toBe("UNSIGNED_EXECUTE_XDR");
    expect(calls.submit).toEqual([]);
    expect(calls.execute).toEqual([]);
    expect(calls.createProposal).toEqual([]);
    expect(calls.executeUpgrade).toEqual([]);
    expect(calls.buildExecuteUpgradeTx).toEqual([`GEXECUTOR:9:${WASM_HASH}:GEXECUTOR`]);
  });

  it("execute submits the pre-signed XDR", async () => {
    const { client, calls } = createMockSdkClient();

    const result = await runMultisigCommand({
      action: "execute",
      client,
      signatureFile: "execute.signed.xdr",
      readFile: () => "  SIGNED_EXECUTE_XDR\n",
    });

    expect(calls.execute).toEqual(["SIGNED_EXECUTE_XDR"]);
    expect(calls.submit).toEqual([]);
    expect(calls.executeUpgrade).toEqual([]);
    expect(result.submitted).toBe(true);
    expect(result.hash).toBe("hash-execute-signed");
  });

  it("propose --signature-file submits and returns the proposal id", async () => {
    const { client, calls } = createMockSdkClient();

    const result = await runMultisigCommand({
      action: "propose",
      client,
      signatureFile: "propose.signed.xdr",
      readFile: () => "SIGNED_PROPOSE_XDR",
    });

    expect(calls.submit).toEqual(["SIGNED_PROPOSE_XDR"]);
    expect(calls.createProposal).toEqual([]);
    expect(result.proposalId).toBe(7n);
    expect(result.submitted).toBe(true);
  });

  it("rejects offline mode without a destination file", async () => {
    const { client } = createMockSdkClient();
    await expect(
      runMultisigCommand({
        action: "approve",
        client,
        offline: true,
        publicKey: "GADMIN",
        proposalId: "1",
      })
    ).rejects.toThrow(/--out <file> is required/);
  });
});
