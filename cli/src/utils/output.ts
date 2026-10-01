// SPDX-License-Identifier: MIT
import { Command } from "commander";

/**
 * Attach `--json` to a command that prints a contract id, balance, or transaction hash.
 * Human text stays the default. JSON is written to stdout only when the flag is set.
 */
export function addJsonOption(command: Command, description?: string): Command {
  command.option(
    "--json",
    description ?? "Print the result as JSON on stdout",
  );
  return command;
}

/**
 * Write one JSON document to stdout. Bigints become decimal strings so
 * balances and proposal ids survive `JSON.parse`.
 */
export function writeJson(value: unknown): void {
  const text = JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString() : item,
  );
  process.stdout.write(`${text}\n`);
}
