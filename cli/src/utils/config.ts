// SPDX-License-Identifier: MIT
import { loadConfigFile, BcForgeConfig } from './config-parser.js';
import logger from './logger.js';
import {
  resolveNetworkConfig,
  type NetworkOverrides,
} from '../network.js';

// Config storage using a simple JSON file approach instead of Conf
// to avoid ESM compatibility issues
import * as fs from 'node:fs';
import * as path from 'node:path';

const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.bc-forge-cli'
);
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface StoredConfig {
  network?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
  contractId?: string;
  secretKey?: string;
  /** Named address book: account name to Ed25519 public key. */
  accounts?: Record<string, string>;
}

/** CLI config file. `BC_FORGE_CLI_CONFIG` overrides the default `~/.bc-forge-cli/config.json`. */
export function getCliConfigPath(): string {
  const override = process.env.BC_FORGE_CLI_CONFIG?.trim();
  if (override) return path.resolve(override);
  return CONFIG_FILE;
}

function readStoredConfig(): StoredConfig {
  try {
    const file = getCliConfigPath();
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeStoredConfig(config: StoredConfig): void {
  try {
    const file = getCliConfigPath();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(file, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // ignore - config storage is best-effort
  }
}

const storedConfig = readStoredConfig();

// Try loading dotenv
try {
  const dotenv = await import('dotenv');
  dotenv.config();
} catch {
  // dotenv not available, continue without it
}

export function getFileConfig(): BcForgeConfig | undefined {
  const result = loadConfigFile();
  if (result.success && result.config) {
    logger.debug(`Loaded config from ${result.filePath}`);
    return result.config;
  }
  
  // Log validation errors if config file exists but is invalid
  if (!result.success && result.errors && result.errors.length > 0) {
    logger.warn(`Configuration validation errors in ${result.filePath}:`);
    result.errors.forEach((error) => {
      logger.warn(`  • ${error}`);
    });
  }
  
  return undefined;
}

export function getClientConfig(overrides: NetworkOverrides = {}) {
  const fileCfg = getFileConfig();
  const hasExplicitNetwork = Boolean(overrides.network?.trim());
  const rpcFromEnvFile = process.env.RPC_URL || fileCfg?.rpcUrl || storedConfig.rpcUrl;
  const passphraseFromEnvFile =
    process.env.NETWORK_PASSPHRASE ||
    fileCfg?.networkPassphrase ||
    storedConfig.networkPassphrase;

  const inputs: NetworkOverrides = {
    network:
      overrides.network ||
      process.env.NETWORK ||
      fileCfg?.network ||
      storedConfig.network ||
      'testnet',
    rpcUrl:
      overrides.rpcUrl ||
      (hasExplicitNetwork ? undefined : rpcFromEnvFile),
    networkPassphrase:
      overrides.networkPassphrase ||
      (hasExplicitNetwork ? undefined : passphraseFromEnvFile),
  };

  const resolved = resolveNetworkConfig(inputs);
  return {
    network: resolved.name,
    rpcUrl: resolved.rpcUrl,
    networkPassphrase: resolved.networkPassphrase,
    contractId: (process.env.CONTRACT_ID || fileCfg?.contracts?.token?.contractId || storedConfig.contractId || '') as string,
  };
}

/**
 * Resolves a signing secret without requiring it on the command line (#1318).
 *
 * Precedence: `--source` / `--secret-key` flag (discouraged, warns), then
 * `STELLAR_SECRET_KEY`, then the legacy `SECRET_KEY`, then config files.
 */
export function getSecretKey() {
  const fileCfg = getFileConfig();
  return (process.env.STELLAR_SECRET_KEY ||
    process.env.SECRET_KEY ||
    fileCfg?.secretKey ||
    storedConfig.secretKey ||
    '') as string;
}

/** Masked prompt callback; injected by callers so tests need no real TTY. */
export type SecretPrompt = () => Promise<string>;

/**
 * Resolves the source secret for a command.
 *
 * Passing a secret on the command line still works but is logged with a
 * security warning: argv leaks into shell history and process listings.
 */
export async function resolveSourceSecret(
  flagValue?: string,
  prompt?: SecretPrompt,
): Promise<string> {
  if (flagValue) {
    logger.warn(
      "Passing a secret via --source exposes it in shell history and process listings; use STELLAR_SECRET_KEY or an interactive prompt instead."
    );
    return flagValue;
  }

  const fromEnvironment = getSecretKey();
  if (fromEnvironment) return fromEnvironment;

  if (prompt && process.stdin.isTTY) {
    return prompt();
  }

  throw new Error(
    "No signing secret found: pass --source, set STELLAR_SECRET_KEY, or run in an interactive terminal."
  );
}

export { loadConfigFile, saveConfigFile, validateConfig, type BcForgeConfig } from './config-parser.js';

// Simple config object that matches the Conf-like interface
const config = {
  get(key: string): string | undefined {
    const c = readStoredConfig();
    return (c as any)[key];
  },
  set(key: string, value: string): void {
    const c = readStoredConfig();
    (c as any)[key] = value;
    writeStoredConfig(c);
  },
  has(key: string): boolean {
    return this.get(key) !== undefined;
  },
  delete(key: string): void {
    const c = readStoredConfig();
    delete (c as any)[key];
    writeStoredConfig(c);
  },
};

export default config;
