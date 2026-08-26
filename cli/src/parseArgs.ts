import { Command } from "commander";
import { createUpgradeCommand } from "./commands/upgrade.js";
import { createSmokeTestCommand } from "./commands/smoke-test.js";
import { createCheckStatusCommand } from "./commands/check-status.js";

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

  program
    .addCommand(createUpgradeCommand())
    .addCommand(createSmokeTestCommand())
    .addCommand(createCheckStatusCommand());

  return program;
}

/**
 * Parse CLI arguments and execute the matched command.
 * Returns the parsed options or throws on parse error.
 */
export async function parseArgs(argv: string[] = process.argv): Promise<any> {
  const program = buildProgram();
  await program.parseAsync(argv);
}
