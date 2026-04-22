#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import config, { getClientConfig, getSecretKey } from './utils/config.js';

const program = new Command();

program
  .name('bc-forge')
  .description('Administrative CLI for bc-forge token contracts')
  .version('1.0.0');

// ─── Config Commands ────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage CLI configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (rpcUrl, networkPassphrase, contractId, secretKey)')
  .action((key, value) => {
    config.set(key, value);
    console.log(chalk.green(`✓ Set ${key} to ${value}`));
  });

configCmd
  .command('list')
  .description('List current configuration')
  .action(() => {
    console.log(chalk.blue('Current Configuration:'));
    console.log(config.store);
  });

// ─── Token Commands ─────────────────────────────────────────────────────────

program
  .command('balance <address>')
  .description('Check token balance for an address')
  .action(async (address) => {
    try {
      const client = new bcForgeClient(getClientConfig());
      const balance = await client.getBalance(address);
      console.log(chalk.cyan(`Balance for ${address}: `) + chalk.white(balance.toString()));
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program
  .command('initialize')
  .description('Initialize a new token contract')
  .requiredOption('--admin <address>', 'Admin address')
  .requiredOption('--decimals <number>', 'Decimal places', '7')
  .requiredOption('--name <string>', 'Token name')
  .requiredOption('--symbol <string>', 'Token symbol')
  .action(async (options) => {
    try {
      const secret = getSecretKey();
      if (!secret) throw new Error('Secret key not configured. Use `bc-forge config set secretKey <key>`');
      
      const source = Keypair.fromSecret(secret);
      const client = new bcForgeClient(getClientConfig());
      
      console.log(chalk.yellow('Initializing contract...'));
      const result = await client.initialize(
        options.admin,
        parseInt(options.decimals),
        options.name,
        options.symbol,
        source
      );
      
      if (result.success) {
        console.log(chalk.green(`✓ Contract initialized. TX: ${result.hash}`));
      } else {
        console.log(chalk.red(`✗ Initialization failed. TX: ${result.hash}`));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program
  .command('mint <to> <amount>')
  .description('Mint tokens to an address')
  .action(async (to, amount) => {
    try {
      const secret = getSecretKey();
      if (!secret) throw new Error('Secret key not configured');
      
      const source = Keypair.fromSecret(secret);
      const client = new bcForgeClient(getClientConfig());
      
      console.log(chalk.yellow(`Minting ${amount} tokens to ${to}...`));
      const result = await client.mint(to, BigInt(amount), source);
      
      if (result.success) {
        console.log(chalk.green(`✓ Minted successfully. TX: ${result.hash}`));
      } else {
        console.log(chalk.red('✗ Minting failed.'));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program
  .command('pause')
  .description('Pause token operations')
  .action(async () => {
    try {
      const secret = getSecretKey();
      if (!secret) throw new Error('Secret key not configured');
      
      const source = Keypair.fromSecret(secret);
      const client = new bcForgeClient(getClientConfig());
      
      console.log(chalk.yellow('Pausing contract...'));
      const result = await client.pause(source);
      
      if (result.success) {
        console.log(chalk.green(`✓ Contract paused. TX: ${result.hash}`));
      } else {
        console.log(chalk.red('✗ Pause failed.'));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program
  .command('unpause')
  .description('Unpause token operations')
  .action(async () => {
    try {
      const secret = getSecretKey();
      if (!secret) throw new Error('Secret key not configured');
      
      const source = Keypair.fromSecret(secret);
      const client = new bcForgeClient(getClientConfig());
      
      console.log(chalk.yellow('Unpausing contract...'));
      const result = await client.unpause(source);
      
      if (result.success) {
        console.log(chalk.green(`✓ Contract unpaused. TX: ${result.hash}`));
      } else {
        console.log(chalk.red('✗ Unpause failed.'));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    }
  });

program.parse();
