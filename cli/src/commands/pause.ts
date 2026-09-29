// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { bcForgeClient } from "@bc-forge/sdk";
import { addNetworkOptions } from "../network.js";
import { getSecretKey } from "../utils/config.js";
import { resolveContractIdOption } from "../utils/registry.js";
import logger from "../utils/logger.js";
import { runPauseCommand, type PauseAction } from "../utils/pause.js";

/**
 * Build the `pause` or `unpause` command.
 *
 * The pauser tool exists so an operator can halt a contract during an incident
 * without writing a new script. It supports a hot key, a pre-signed transaction
 * file (hardware wallet / offline), and building an unsigned transaction for an
 * external signer.
 */
export function createPauseCommand(action: PauseAction): Command {
  const verb = action === "pause" ? "Pause" : "Unpause";

  const cmd = new Command(action)
    .description(`${verb} token operations (incident response)`)
    .option("--contract-id <id>", "Contract ID, or a deployment alias for the selected network")
    .option("--source <secret>", "Admin or Pauser source account secret key")
    .option("--signature <file>", "Submit a pre-signed transaction XDR from a file")
    .option("--build-only", "Build an unsigned transaction without signing or submitting", false)
    .option("--out <file>", "Write the unsigned XDR to a file (used with --build-only)")
    .option("--public-key <key>", "Caller public key (used with --build-only)");

  addNetworkOptions(cmd);

  cmd.action(async (opts, command) => {
    try {
      const contractId =
        resolveContractIdOption(command, opts.contractId) ?? opts.contractId;
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

      const result = await runPauseCommand({
        action,
        client,
        signatureFile: opts.signature,
        buildOnly: opts.buildOnly,
        outFile: opts.out,
        publicKey: opts.publicKey,
        secretKey: opts.source ?? getSecretKey() ?? undefined,
      });

      if (result.submitted) {
        logger.info(`${verb} confirmed (tx ${result.hash})`);
      } else {
        logger.info(
          `Unsigned ${action} transaction built${opts.out ? ` and written to ${opts.out}` : ""}`
        );
      }
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

  return cmd;
}
