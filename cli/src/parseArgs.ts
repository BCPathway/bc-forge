// SPDX-License-Identifier: MIT
import { Command, CommanderError } from "commander";
import { createUpgradeCommand } from "./commands/upgrade.js";
import { createSmokeTestCommand } from "./commands/smoke-test.js";
import { createCheckStatusCommand } from "./commands/check-status.js";
import { createDoctorCommand } from "./commands/doctor.js";
import { createVerifyHashCommand } from "./commands/verify-hash.js";
import { createGenerateBindingsCommand } from "./commands/generate-bindings.js";
import {
  createInitSuperAdminCommand,
  createConnectCommand,
  createOrchestrateCommand,
} from "./commands/orchestrator.js";
import { createDeployCommand } from "./commands/deploy.js";
import { createExportDeploymentsCommand } from "./commands/export-deployments.js";
import { createBatchMintCommand } from "./commands/batch-mint.js";
import { createAccountCommand } from "./commands/account.js";
import { createPauseCommand } from "./commands/pause.js";
import { createMultisigCommand } from "./commands/multisig.js";
import { createInitCommand } from "./commands/init.js";
import { createDeploymentsCommand } from "./commands/deployments.js";
import { createCompletionsCommand } from "./commands/completions.js";
import { addNetworkOptions, attachNetworkResolution } from "./network.js";

const VERSION = "0.1.0";

/**
 * Help and version are normal exits. Commander 15 uses `commander.help` when
 * no subcommand was given, and `commander.helpDisplayed` for `--help`.
 */
function isUsageExit(err: CommanderError): boolean {
  return (
    err.code === "commander.help" ||
    err.code === "commander.helpDisplayed" ||
    err.code === "commander.version"
  );
}

/**
 * Build and return the top-level CLI program.
 * Extracted so tests can call it without process.exit side-effects.
 */
export function buildProgram(): Command {
  const program = new Command()
    .name("bc-forge")
    .description("CLI deployment orchestrator for bc-forge Soroban contracts")
    .version(VERSION)
    .configureOutput({
      writeErr: (str) => process.stderr.write(str),
      writeOut: (str) => process.stdout.write(str),
    });

  addNetworkOptions(program, { withDefault: true });
  attachNetworkResolution(program);

  program
    .addCommand(createInitCommand())
    .addCommand(createDeploymentsCommand())
    .addCommand(createUpgradeCommand())
    .addCommand(createSmokeTestCommand())
    .addCommand(createCheckStatusCommand())
    .addCommand(createDoctorCommand())
    .addCommand(createVerifyHashCommand())
    .addCommand(createGenerateBindingsCommand())
    .addCommand(createDeployCommand())
    .addCommand(createInitSuperAdminCommand())
    .addCommand(createConnectCommand())
    .addCommand(createOrchestrateCommand())
    .addCommand(createExportDeploymentsCommand())
    .addCommand(createBatchMintCommand())
    .addCommand(createAccountCommand())
    .addCommand(createPauseCommand("pause"))
    .addCommand(createPauseCommand("unpause"))
    .addCommand(createMultisigCommand())
    .addCommand(createCompletionsCommand());

  return program;
}

/**
 * Parse CLI arguments, execute the matched command, and return the options
 * that command resolved.
 *
 * The return value is what the matched subcommand's action received as its
 * options object, taken from the command Commander actually invoked. It is
 * `undefined` when no subcommand ran — `--help`, `--version`, or a bare
 * invocation — because there are no command options to report. Help and
 * version still print, then return. A parse error is thrown, not returned.
 */
export async function parseArgs(
  argv: string[] = process.argv,
): Promise<Record<string, unknown> | undefined> {
  const program = buildProgram();
  program.exitOverride();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CommanderError && isUsageExit(err)) {
      return undefined;
    }
    throw err;
  }

  const [invokedName] = program.args;
  if (!invokedName) {
    return undefined;
  }

  const invoked = program.commands.find(
    (candidate) =>
      candidate.name() === invokedName || candidate.aliases().includes(invokedName),
  );

  return invoked ? (invoked.opts() as Record<string, unknown>) : undefined;
}
