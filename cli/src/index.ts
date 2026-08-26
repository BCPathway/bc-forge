#!/usr/bin/env node

import { Command } from 'commander';
import { bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';
import config, { getClientConfig, getSecretKey, loadConfigFile, saveConfigFile, validateConfig, BcForgeConfig } from './utils/config.js';
import logger, { enableDebugMode } from './utils/logger.js';
import { initializeSuperAdmin, connectContractIds, runDeploymentOrchestrator } from './orchestrator/index.js';

const program = new Command();

program
  .name('bc-forge')
  .description('Administrative CLI for bc-forge token contracts')
  .version('1.0.0')
  .option('-d, --debug', 'Enable debug logging mode');

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.debug) {
    enableDebugMode(true);
  }
});

// ─── Config Commands ────────────────────────────────────────────────────────

const configCmd = program.command('config').description('Manage CLI and deployment configuration');

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (rpcUrl, networkPassphrase, contractId, secretKey)')
  .action((key, value) => {
    config.set(key, value);
    logger.success(`Set ${key} to ${value}`);
  });

configCmd
  .command('list')
  .description('List current CLI user store configuration')
  .action(() => {
    logger.info('Current Configuration Store:');
    console.log(config.store);
  });

configCmd
  .command('load [file]')
  .description('Load and validate a deployment configuration file (.bc-forge.json)')
  .action((file) => {
    logger.debug(`Attempting to load config file: ${file || '.bc-forge.json'}`);
    const result = loadConfigFile(file);
    if (result.success && result.config) {
      logger.success(`Successfully loaded configuration file: ${result.filePath}`);
      logger.info(`Project Name: ${result.config.name}`);
      logger.info(`Symbol:       ${result.config.symbol}`);
      logger.info(`Network:      ${result.config.network}`);
      if (result.config.admin) logger.info(`Admin:        ${result.config.admin}`);
    } else {
      logger.error(`Failed to load configuration file:`);
      result.errors?.forEach(err => logger.error(`  - ${err}`));
      process.exitCode = 1;
    }
  });

configCmd
  .command('init')
  .description('Initialize a new template .bc-forge.json file')
  .option('--name <string>', 'Token name', 'MyToken')
  .option('--symbol <string>', 'Token symbol', 'MTK')
  .option('--decimals <number>', 'Token decimals', '7')
  .action((options) => {
    const templateConfig: BcForgeConfig = {
      version: '1.0.0',
      name: options.name,
      symbol: options.symbol,
      decimals: parseInt(options.decimals, 10),
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015'
    };

    const result = saveConfigFile(templateConfig);
    if (result.success) {
      logger.success(`Initialized config file at: ${result.filePath}`);
    } else {
      logger.error(`Failed to create config file:`);
      result.errors?.forEach(err => logger.error(`  - ${err}`));
      process.exitCode = 1;
    }
  });

// ─── Token Commands ─────────────────────────────────────────────────────────

program
  .command('balance <address>')
  .description('Check token balance for an address')
  .action(async (address) => {
    try {
      logger.debug(`Fetching balance for address: ${address}`);
      const clientConfig = getClientConfig();
      logger.debug(`RPC URL: ${clientConfig.rpcUrl}`);
      const client = new bcForgeClient(clientConfig);
      const balance = await client.getBalance(address);
      logger.info(`Balance for ${address}: ${balance.toString()}`);
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('initialize')
  .description('Initialize a new token contract')
  .option('--admin <address>', 'Admin address')
  .option('--decimals <number>', 'Decimal places')
  .option('--name <string>', 'Token name')
  .option('--symbol <string>', 'Token symbol')
  .action(async (options) => {
    try {
      const fileConfig = loadConfigFile().config;
      const admin = options.admin || fileConfig?.admin;
      const decimals = options.decimals ? parseInt(options.decimals, 10) : fileConfig?.decimals || 7;
      const name = options.name || fileConfig?.name;
      const symbol = options.symbol || fileConfig?.symbol;

      if (!admin || !name || !symbol) {
        throw new Error('Missing required options: admin, name, symbol must be specified or present in .bc-forge.json');
      }

      const secret = getSecretKey();
      if (!secret) throw new Error('Secret key not configured. Use `bc-forge config set secretKey <key>` or set SECRET_KEY env variable');

      const source = Keypair.fromSecret(secret);
      const client = new bcForgeClient(getClientConfig());

      logger.warn('Initializing contract...');
      logger.debug(`Init params: name=${name}, symbol=${symbol}, decimals=${decimals}, admin=${admin}`);
      
      const result = await client.initialize(admin, decimals, name, symbol, source);

      if (result.success) {
        logger.success(`Contract initialized. TX: ${result.hash}`);
      } else {
        logger.error(`Initialization failed. TX: ${result.hash}`);
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
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

      logger.warn(`Minting ${amount} tokens to ${to}...`);
      logger.debug(`Sending mint tx to target: ${to}, amount: ${amount}`);
      const result = await client.mint(to, BigInt(amount), source);

      if (result.success) {
        logger.success(`Minted successfully. TX: ${result.hash}`);
      } else {
        logger.error('Minting failed.');
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
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

      logger.warn('Pausing contract...');
      const result = await client.pause(source);

      if (result.success) {
        logger.success(`Contract paused. TX: ${result.hash}`);
      } else {
        logger.error('Pause failed.');
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
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

      logger.warn('Unpausing contract...');
      const result = await client.unpause(source);

      if (result.success) {
        logger.success(`Contract unpaused. TX: ${result.hash}`);
      } else {
        logger.error('Unpause failed.');
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

// ─── Deployment Orchestrator Commands ───────────────────────────────────────

program
  .command('init-superadmin')
  .description('Initialize contract natively with deployer as SuperAdmin and verify on-chain')
  .option('--contract-id <string>', 'Contract ID to initialize')
  .option('--deployer <string>', 'Deployer Stellar public key (G...)')
  .option('--secret-key <string>', 'Deployer secret key (S...)')
  .option('--name <string>', 'Token name')
  .option('--symbol <string>', 'Token symbol')
  .option('--decimals <number>', 'Decimal places')
  .option('--no-verify', 'Skip on-chain SuperAdmin verification')
  .action(async (options) => {
    try {
      const result = await initializeSuperAdmin({
        contractId: options.contractId,
        deployer: options.deployer,
        secretKey: options.secretKey,
        name: options.name,
        symbol: options.symbol,
        decimals: options.decimals ? parseInt(options.decimals, 10) : undefined,
        verify: options.verify,
      });
      if (!result.success) {
        logger.error(`Failed to initialize SuperAdmin: ${result.error}`);
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('connect')
  .alias('link')
  .description('Connect deployed contract IDs post-deployment')
  .option('--admin <string>', 'Admin Contract ID')
  .option('--token <string>', 'Token Contract ID')
  .option('--vesting <string>', 'Vesting Contract ID')
  .option('--wrapper <string>', 'Wrapper Contract ID')
  .option('--secret-key <string>', 'Deployer secret key')
  .option('--file [file]', 'Path to .bc-forge.json')
  .action(async (options) => {
    try {
      const result = await connectContractIds({
        adminContractId: options.admin,
        tokenContractId: options.token,
        vestingContractId: options.vesting,
        wrapperContractId: options.wrapper,
        secretKey: options.secretKey,
        configPath: options.file,
      });
      if (!result.success) {
        logger.error('Failed to connect contract IDs:');
        result.errors?.forEach(err => logger.error(`  - ${err}`));
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('orchestrate')
  .description('Run full deployment orchestrator: initialize SuperAdmin and connect contract IDs')
  .option('--admin <string>', 'Admin Contract ID')
  .option('--token <string>', 'Token Contract ID')
  .option('--vesting <string>', 'Vesting Contract ID')
  .option('--wrapper <string>', 'Wrapper Contract ID')
  .option('--name <string>', 'Token name')
  .option('--symbol <string>', 'Token symbol')
  .option('--decimals <number>', 'Token decimals')
  .option('--secret-key <string>', 'Deployer secret key')
  .option('--file [file]', 'Path to .bc-forge.json')
  .option('--skip-verify', 'Skip on-chain verification steps')
  .action(async (options) => {
    try {
      const result = await runDeploymentOrchestrator({
        adminContractId: options.admin,
        tokenContractId: options.token,
        vestingContractId: options.vesting,
        wrapperContractId: options.wrapper,
        name: options.name,
        symbol: options.symbol,
        decimals: options.decimals ? parseInt(options.decimals, 10) : undefined,
        secretKey: options.secretKey,
        configPath: options.file,
        skipVerify: options.skipVerify,
      });
      if (!result.success) {
        logger.error('Orchestration encountered errors.');
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program.parse();
