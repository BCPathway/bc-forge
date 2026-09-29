// SPDX-License-Identifier: MIT
import { Command } from "commander";
import { addNetworkOptions } from "../network.js";

export interface BatchMintRecipient {
  to: string;
  amount: string;
}

/**
 * Parse one `address:amount` spec for `batch_mint`.
 * The amount is the trailing colon-separated field so addresses stay intact.
 */
export function parseRecipientSpec(spec: string): BatchMintRecipient {
  const separator = spec.lastIndexOf(":");
  if (separator <= 0 || separator === spec.length - 1) {
    throw new Error(
      `Invalid recipient "${spec}". Expected <address>:<amount>.`,
    );
  }
  const to = spec.slice(0, separator).trim();
  const amount = spec.slice(separator + 1).trim();
  if (!/^[1-9]\d*$/.test(amount)) {
    throw new Error(
      `Invalid amount "${amount}" for recipient ${to}. Expected a positive integer.`,
    );
  }
  if (to.length === 0) {
    throw new Error(`Invalid recipient "${spec}". Address is empty.`);
  }
  return { to, amount };
}

export function createBatchMintCommand(): Command {
  const cmd = new Command("batch-mint")
    .description(
      "Parse a batch_mint invocation: contract, source, and repeatable address:amount recipients",
    )
    .requiredOption("--contract-id <id>", "Contract ID of the token to mint")
    .requiredOption("--source <secret>", "Minter source account secret key")
    .option(
      "--recipient <address:amount>",
      "Recipient and amount (repeatable)",
      (value: string, previous: BatchMintRecipient[]) => {
        previous.push(parseRecipientSpec(value));
        return previous;
      },
      [] as BatchMintRecipient[],
    );

  addNetworkOptions(cmd);

  cmd.action((opts: { recipient?: BatchMintRecipient[] }) => {
    const recipients = opts.recipient ?? [];
    if (recipients.length === 0) {
      throw new Error(
        "batch-mint requires at least one --recipient <address>:<amount>.",
      );
    }
  });

  return cmd;
}
