import fs from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Command } from 'commander';
import {
  NETWORK_PRESETS,
  parseNetworkName,
  resolveNetworkConfig,
  type NetworkName,
} from '../network.js';
import logger from '../utils/logger.js';

const CONFIG_FILENAME = 'config.json';
const ADMIN_REGEX = /^G[A-Z2-7]{55}$/;
const SYMBOL_REGEX = /^[A-Za-z0-9]{1,12}$/;
const SUPPLY_REGEX = /^(0|[1-9]\d*)$/;

export interface InitFlagValues {
  network?: string;
  rpcUrl?: string;
  admin?: string;
  name?: string;
  symbol?: string;
  decimals?: string;
  initialSupply?: string;
  force?: boolean;
}

export interface InitConfig {
  network: NetworkName;
  rpcUrl: string;
  admin: string;
  name: string;
  symbol: string;
  decimals: number;
  initialSupply: string;
}

export type InitPrompt = (label: string, defaultValue?: string) => Promise<string>;

export interface RunInitInput {
  flags: InitFlagValues;
  cwd?: string;
  interactive: boolean;
  prompt?: InitPrompt;
}

export interface RunInitResult {
  filePath: string;
  config: InitConfig;
}

function optionRegistered(command: Command, key: string): boolean {
  return command.options.some((option) => option.attributeName() === key);
}

/**
 * A flag the user actually typed, walking from this command up to the root.
 * Defaults applied by the network hook are ignored so interactive init still prompts.
 */
export function explicitFlag(command: Command, key: string): string | undefined {
  let current: Command | null = command;
  while (current) {
    if (optionRegistered(current, key)) {
      try {
        if (current.getOptionValueSource(key) === 'cli') {
          const value = current.opts()[key];
          if (typeof value === 'string' && value.trim() !== '') return value.trim();
        }
      } catch {
        // Option exists but has no stored source yet.
      }
    }
    current = current.parent;
  }
  return undefined;
}

function parseDecimals(raw: string): number {
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`Decimals must be an integer from 0 to 18, got "${raw}".`);
  }
  const decimals = Number(raw);
  if (decimals < 0 || decimals > 18) {
    throw new Error(`Decimals must be an integer from 0 to 18, got "${raw}".`);
  }
  return decimals;
}

function validateInitConfig(input: {
  network: string;
  rpcUrl: string;
  admin: string;
  name: string;
  symbol: string;
  decimals: string;
  initialSupply: string;
}): InitConfig {
  const network = parseNetworkName(input.network);
  const resolved = resolveNetworkConfig({ network, rpcUrl: input.rpcUrl });
  const admin = input.admin.trim();
  const name = input.name.trim();
  const symbol = input.symbol.trim();
  const initialSupply = input.initialSupply.trim();

  if (!ADMIN_REGEX.test(admin)) {
    throw new Error(`Invalid admin public key "${admin}". Expected a 56-character G... address.`);
  }
  if (!name) {
    throw new Error('Token name is required.');
  }
  if (!SYMBOL_REGEX.test(symbol)) {
    throw new Error(`Token symbol must be 1-12 letters or digits, got "${symbol}".`);
  }
  if (!SUPPLY_REGEX.test(initialSupply)) {
    throw new Error(`Initial supply must be a non-negative integer, got "${initialSupply}".`);
  }

  return {
    network: resolved.name,
    rpcUrl: resolved.rpcUrl,
    admin,
    name,
    symbol,
    decimals: parseDecimals(input.decimals),
    initialSupply,
  };
}

function missingRequiredFlags(flags: InitFlagValues): string[] {
  const missing: string[] = [];
  if (!flags.admin?.trim()) missing.push('--admin');
  if (!flags.name?.trim()) missing.push('--name');
  if (!flags.symbol?.trim()) missing.push('--symbol');
  if (!flags.initialSupply?.trim()) missing.push('--initial-supply');
  return missing;
}

async function promptWithReadline(label: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const hint = defaultValue ? ` (${defaultValue})` : '';
    const answer = (await rl.question(`${label}${hint}: `)).trim();
    return answer || defaultValue || '';
  } finally {
    rl.close();
  }
}

async function collectInteractive(flags: InitFlagValues, prompt: InitPrompt): Promise<InitConfig> {
  const networkInput = flags.network?.trim() || (await prompt('Network', 'testnet')) || 'testnet';
  const network = parseNetworkName(networkInput);
  const rpcDefault = NETWORK_PRESETS[network].rpcUrl;
  const rpcUrl = flags.rpcUrl?.trim() || (await prompt('RPC URL', rpcDefault)) || rpcDefault;
  const admin = flags.admin?.trim() || (await prompt('Admin public key'));
  const name = flags.name?.trim() || (await prompt('Token name'));
  const symbol = flags.symbol?.trim() || (await prompt('Token symbol'));
  const decimals = flags.decimals?.trim() || (await prompt('Decimals', '7')) || '7';
  const initialSupply = flags.initialSupply?.trim() || (await prompt('Initial supply'));

  return validateInitConfig({
    network,
    rpcUrl,
    admin,
    name,
    symbol,
    decimals,
    initialSupply,
  });
}

function collectNonInteractive(flags: InitFlagValues): InitConfig {
  const missing = missingRequiredFlags(flags);
  if (missing.length > 0) {
    throw new Error(
      `Non-interactive init requires ${missing.join(', ')}. ` +
        'Pass a flag for every prompt, or run bc-forge init in a terminal.'
    );
  }

  const network = parseNetworkName(flags.network?.trim() || 'testnet');
  const rpcUrl = flags.rpcUrl?.trim() || NETWORK_PRESETS[network].rpcUrl;
  const decimals = flags.decimals?.trim() || '7';

  return validateInitConfig({
    network,
    rpcUrl,
    admin: flags.admin ?? '',
    name: flags.name ?? '',
    symbol: flags.symbol ?? '',
    decimals,
    initialSupply: flags.initialSupply ?? '',
  });
}

/**
 * Writes `config.json` for a new bc-forge project.
 * Refuses to replace an existing file unless `flags.force` is set.
 * The file stores public project settings only — never a secret key.
 */
export async function runInit(input: RunInitInput): Promise<RunInitResult> {
  const cwd = input.cwd ?? process.cwd();
  const filePath = path.resolve(cwd, CONFIG_FILENAME);

  if (fs.existsSync(filePath) && !input.flags.force) {
    throw new Error(`Refusing to overwrite ${filePath}. Re-run with --force to replace it.`);
  }

  const config = input.interactive
    ? await collectInteractive(input.flags, input.prompt ?? promptWithReadline)
    : collectNonInteractive(input.flags);

  const body = {
    network: config.network,
    rpcUrl: config.rpcUrl,
    admin: config.admin,
    name: config.name,
    symbol: config.symbol,
    decimals: config.decimals,
    initialSupply: config.initialSupply,
  };

  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf-8');

  return { filePath, config };
}

/**
 * Builds the `init` command. Prompts in a terminal, or accepts one flag per prompt for CI.
 */
export function createInitCommand(): Command {
  const cmd = new Command('init')
    .description('Scaffold config.json with network, admin, and token supply settings')
    .option('-n, --network <name>', 'Target network (testnet, mainnet, or local). Default: testnet')
    .option('--rpc-url <url>', 'Soroban RPC URL (defaults to the selected network preset)')
    .option('--admin <publicKey>', 'Admin public key (G...)')
    .option('--name <name>', 'Token name')
    .option('--symbol <symbol>', 'Token symbol')
    .option('--decimals <n>', 'Token decimals (default: 7)')
    .option('--initial-supply <amount>', 'Initial token supply')
    .option('--force', 'Overwrite an existing config.json', false);

  cmd.action(async (opts, command: Command) => {
    try {
      const flags: InitFlagValues = {
        network: explicitFlag(command, 'network'),
        rpcUrl: explicitFlag(command, 'rpcUrl'),
        admin: explicitFlag(command, 'admin'),
        name: explicitFlag(command, 'name'),
        symbol: explicitFlag(command, 'symbol'),
        decimals: explicitFlag(command, 'decimals'),
        initialSupply: explicitFlag(command, 'initialSupply'),
        force: opts.force === true,
      };

      const result = await runInit({
        flags,
        interactive: Boolean(process.stdin.isTTY),
        cwd: process.cwd(),
      });

      logger.success(`Wrote ${result.filePath}`);
      logger.info(`  network:        ${result.config.network}`);
      logger.info(`  rpc url:        ${result.config.rpcUrl}`);
      logger.info(`  admin:          ${result.config.admin}`);
      logger.info(`  token:          ${result.config.name} (${result.config.symbol})`);
      logger.info(`  decimals:       ${result.config.decimals}`);
      logger.info(`  initial supply: ${result.config.initialSupply}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(message);
      process.exitCode = 1;
    }
  });

  return cmd;
}
