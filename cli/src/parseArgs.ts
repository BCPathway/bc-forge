import { Command } from "commander";
import { createUpgradeCommand } from "./commands/upgrade.js";
import { createSmokeTestCommand } from "./commands/smoke-test.js";
import { createCheckStatusCommand } from "./commands/check-status.js";
import { createVerifyHashCommand } from "./commands/verify-hash.js";
import { createGenerateBindingsCommand } from "./commands/generate-bindings.js";
import {
  createInitSuperAdminCommand,
  createConnectCommand,
  createOrchestrateCommand,
} from "./commands/orchestrator.js";
import { createDeployCommand } from "./commands/deploy.js";
import { createExportDeploymentsCommand } from "./commands/export-deployments.js";
import { addNetworkOptions, attachNetworkResolution } from "./network.js";

const VERSION = "0.1.0";

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
    .addCommand(createUpgradeCommand())
    .addCommand(createSmokeTestCommand())
    .addCommand(createCheckStatusCommand())
    .addCommand(createVerifyHashCommand())
    .addCommand(createGenerateBindingsCommand())
    .addCommand(createDeployCommand())
    .addCommand(createInitSuperAdminCommand())
    .addCommand(createConnectCommand())
    .addCommand(createOrchestrateCommand())
    .addCommand(createExportDeploymentsCommand());

  return program;
}

/**
 * Parse CLI arguments, execute the matched command, and return the options
 * that command resolved.
 *
 * The return value is what the matched subcommand's action received as its
 * options object, taken from the command Commander actually invoked. It is
 * `undefined` when no subcommand ran — for example `--help`, `--version`, or
 * a bare invocation — because there are no command options to report. A parse
 * error is thrown, not returned.
 */
export async function parseArgs(
  argv: string[] = process.argv,
): Promise<Record<string, unknown> | undefined> {
  const program = buildProgram();
  await program.parseAsync(argv);

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
