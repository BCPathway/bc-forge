// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { bcForgeClient } from "@bc-forge/sdk";
import { addNetworkOptions } from "../network.js";
import { getSecretKey } from "../utils/config.js";
import { resolveContractIdOption } from "../utils/registry.js";
import logger from "../utils/logger.js";
import {
  runMultisigCommand,
  type MultisigAction,
  type MultisigRunResult,
} from "../utils/multisig.js";

/**
 * `multisig propose|approve|execute` for the admin upgrade ceremony.
 *
 * Contract mapping:
 *   propose -> create_proposal
 *   approve -> approve_proposal
 *   execute -> execute_upgrade
 */
export function createMultisigCommand(): Command {
  const root = new Command("multisig").description(
    "Propose, approve, and execute an admin-contract upgrade (offline signing supported)"
  );

  root.addCommand(createStepCommand("propose"));
  root.addCommand(createStepCommand("approve"));
  root.addCommand(createStepCommand("execute"));
  root.addCommand(createCapChangeCommand());
  return root;
}

/** `bc-forge multisig propose-cap-change --new-cap <amount>` (#1329). */
function createCapChangeCommand(): Command {
  const cmd = new Command("propose-cap-change").description(
    "Propose a governed max-supply change (propose_cap_change)"
  );
  cmd
    .requiredOption("--new-cap <amount>", "New maximum supply as an integer")
    .option("--description <text>", "Human-readable proposal description")
    .option("--contract-id <id>", "Token contract ID, or a deployment alias")
    .option("--source <secret>", "Pool member secret key (hot signer)");

  addNetworkOptions(cmd);

  cmd.action(async (opts, command) => {
    try {
      const contractId = resolveContractIdOption(command, opts.contractId) ?? opts.contractId;
      if (!contractId) {
        throw new Error(
          "No contract id: pass --contract-id <id> or set CONTRACT_ID in the environment."
        );
      }
      if (!/^-?\d+$/.test(opts.newCap.trim())) {
        throw new Error("--new-cap must be an integer");
      }
      const newCap = BigInt(opts.newCap.trim());
      if (newCap < 0n) {
        throw new Error("--new-cap must be non-negative");
      }

      const secretKey = opts.source || getSecretKey();
      if (!secretKey) {
        throw new Error("No signer: pass --source or set SECRET_KEY");
      }
      const { Keypair } = await import("@stellar/stellar-sdk");
      const signer = Keypair.fromSecret(secretKey);

      const client = new bcForgeClient({
        rpcUrl: opts.rpcUrl,
        networkPassphrase: opts.networkPassphrase,
        contractId,
      });
      const result = await client.proposeCapChange(
        signer.publicKey(),
        newCap,
        opts.description ?? `Set max supply to ${newCap.toString()}`,
        signer,
      );
      logger.info(`Cap-change proposal submitted (tx ${result.hash ?? "unknown"})`);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

  return cmd;
}

function createStepCommand(action: MultisigAction): Command {
  const descriptions: Record<MultisigAction, string> = {
    propose: "Create an admin governance proposal (create_proposal)",
    approve: "Approve an admin governance proposal (approve_proposal)",
    execute: "Execute an approved upgrade (execute_upgrade)",
  };

  const cmd = new Command(action).description(descriptions[action]);
  cmd
    .option("--contract-id <id>", "Admin contract ID, or a deployment alias for the selected network")
    .option("--source <secret>", "Pool member secret key (hot signer)")
    .option("--public-key <key>", "Pool member public key (required with --offline)")
    .option("--offline", "Write unsigned transaction XDR and do not submit", false)
    .option("--out <file>", "Write the unsigned XDR to this file (required with --offline)")
    .option("--signature-file <file>", "Submit a pre-signed transaction XDR");

  if (action === "propose") {
    cmd.option("--description <text>", "Human-readable proposal description");
  }
  if (action === "approve" || action === "execute") {
    cmd.option("--proposal-id <id>", "Governance proposal id returned by propose");
  }
  if (action === "execute") {
    cmd.option("--wasm-hash <hex>", "32-byte WASM hash to install (64 hex characters)");
  }

  addNetworkOptions(cmd);

  cmd.action(async (opts, command) => {
    try {
      const contractId = resolveContractIdOption(command, opts.contractId) ?? opts.contractId;
      if (!contractId) {
        throw new Error(
          "No contract id: pass --contract-id <id> or set CONTRACT_ID in the environment."
        );
      }

      const client = new bcForgeClient({
        rpcUrl: opts.rpcUrl,
        networkPassphrase: opts.networkPassphrase,
        contractId,
      });

      const result = await runMultisigCommand({
        action,
        client,
        description: opts.description,
        proposalId: opts.proposalId,
        wasmHash: opts.wasmHash,
        offline: opts.offline,
        outFile: opts.out,
        signatureFile: opts.signatureFile,
        publicKey: opts.publicKey,
        secretKey: opts.source || getSecretKey() || undefined,
      });

      logResult(action, result, opts.out);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

  return cmd;
}

function logResult(action: MultisigAction, result: MultisigRunResult, outFile?: string): void {
  if (!result.submitted) {
    logger.info(
      `Unsigned ${action} transaction written${outFile ? ` to ${outFile}` : ""}`
    );
    return;
  }
  if (result.proposalId !== undefined && action === "propose") {
    logger.info(`Proposal ${result.proposalId.toString()} submitted (tx ${result.hash})`);
    return;
  }
  logger.info(`${action} submitted (tx ${result.hash})`);
}
