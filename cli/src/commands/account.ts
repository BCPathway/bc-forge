// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { getCliConfigPath } from '../utils/config.js';
import {
  loadAccounts,
  removeAccount,
  saveAccount,
} from '../utils/address-book.js';
import logger from '../utils/logger.js';

function configPath(file: string | undefined): string {
  return file?.trim() ? file : getCliConfigPath();
}

/**
 * `account add` stores a name for a public key after a StrKey checksum check.
 * `account remove` deletes a name. `account list` prints the book.
 */
export function createAccountCommand(): Command {
  const root = new Command('account')
    .description('Save and resolve named Stellar accounts (address book)');

  const add = new Command('add')
    .description('Save a named account. A bad StrKey checksum fails the command')
    .argument('<name>', 'Account name, such as "treasury"')
    .argument('<publicKey>', 'Stellar public key (G...)')
    .option('-f, --file <path>', 'CLI config JSON path');

  add.action((name: string, publicKey: string, opts: { file?: string }) => {
    try {
      const file = configPath(opts.file);
      saveAccount(name, publicKey, file);
      logger.success(`Saved account "${name.trim()}" to ${file}`);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

  const remove = new Command('remove')
    .description('Remove a named account from the address book')
    .argument('<name>', 'Account name')
    .option('-f, --file <path>', 'CLI config JSON path');

  remove.action((name: string, opts: { file?: string }) => {
    try {
      const file = configPath(opts.file);
      removeAccount(name, file);
      logger.success(`Removed account "${name.trim()}" from ${file}`);
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

  const list = new Command('list')
    .description('Print named accounts')
    .option('-f, --file <path>', 'CLI config JSON path');

  list.action((opts: { file?: string }) => {
    const accounts = loadAccounts(configPath(opts.file));
    const names = Object.keys(accounts).sort();
    if (names.length === 0) {
      logger.info('No named accounts.');
      return;
    }
    for (const name of names) {
      process.stdout.write(`${name} ${accounts[name]}\n`);
    }
  });

  root.addCommand(add);
  root.addCommand(remove);
  root.addCommand(list);
  return root;
}
