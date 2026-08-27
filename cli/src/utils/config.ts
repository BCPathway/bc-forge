import { loadConfigFile, BcForgeConfig } from './config-parser.js';
import logger from './logger.js';

// Config storage using a simple JSON file approach instead of Conf
// to avoid ESM compatibility issues
import * as fs from 'node:fs';
import * as path from 'node:path';

const CONFIG_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '.',
  '.bc-forge-cli'
);
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

interface StoredConfig {
  rpcUrl?: string;
  networkPassphrase?: string;
  contractId?: string;
  secretKey?: string;
}

function readStoredConfig(): StoredConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeStoredConfig(config: StoredConfig): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
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
  return undefined;
}

export function getClientConfig() {
  const fileCfg = getFileConfig();

  return {
    rpcUrl: (process.env.RPC_URL || fileCfg?.rpcUrl || storedConfig.rpcUrl || 'https://soroban-testnet.stellar.org') as string,
    networkPassphrase: (process.env.NETWORK_PASSPHRASE || fileCfg?.networkPassphrase || storedConfig.networkPassphrase || 'Test SDF Network ; September 2015') as string,
    contractId: (process.env.CONTRACT_ID || fileCfg?.contracts?.token?.contractId || storedConfig.contractId || '') as string,
  };
}

export function getSecretKey() {
  const fileCfg = getFileConfig();
  return (process.env.SECRET_KEY || fileCfg?.secretKey || storedConfig.secretKey || '') as string;
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
