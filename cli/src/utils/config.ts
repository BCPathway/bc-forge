import Conf from 'conf';
import dotenv from 'dotenv';
import { loadConfigFile, BcForgeConfig } from './config-parser.js';
import logger from './logger.js';

dotenv.config();

const schema = {
  rpcUrl: {
    type: 'string' as const,
    default: 'https://soroban-testnet.stellar.org'
  },
  networkPassphrase: {
    type: 'string' as const,
    default: 'Test SDF Network ; September 2015'
  },
  contractId: {
    type: 'string' as const,
  },
  secretKey: {
    type: 'string' as const,
  }
};

const config = new Conf({ schema, projectName: 'bc-forge-cli' });

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
    rpcUrl: (process.env.RPC_URL || fileCfg?.rpcUrl || config.get('rpcUrl')) as string,
    networkPassphrase: (process.env.NETWORK_PASSPHRASE || fileCfg?.networkPassphrase || config.get('networkPassphrase')) as string,
    contractId: (process.env.CONTRACT_ID || fileCfg?.contracts?.token?.contractId || config.get('contractId')) as string,
  };
}

export function getSecretKey() {
  const fileCfg = getFileConfig();
  return (process.env.SECRET_KEY || fileCfg?.secretKey || config.get('secretKey')) as string;
}

export { loadConfigFile, saveConfigFile, validateConfig, type BcForgeConfig } from './config-parser.js';
export default config;
