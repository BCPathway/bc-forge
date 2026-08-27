import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const schemaPath = path.resolve(__dirname, '../schema/bc-forge.schema.json');
const bcForgeSchema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));

export interface ContractDeploymentConfig {
  contractId?: string;
  wasmHash?: string;
  deployer?: string;
  adminContractId?: string;
  tokenContractId?: string;
  linkedContracts?: Record<string, string>;
  [key: string]: unknown;
}

export interface BcForgeConfig {
  version?: string;
  name: string;
  symbol: string;
  decimals?: number;
  admin?: string;
  network?: 'mainnet' | 'testnet' | 'futurenet' | 'standalone' | 'custom' | string;
  rpcUrl?: string;
  networkPassphrase?: string;
  secretKey?: string;
  contracts?: Record<string, ContractDeploymentConfig>;
  [key: string]: unknown;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  config?: BcForgeConfig;
}

export interface ConfigParseResult {
  success: boolean;
  config?: BcForgeConfig;
  errors?: string[];
  filePath?: string;
}

const DEFAULT_CONFIG_FILENAME = '.bc-forge.json';

import { Ajv } from 'ajv';

const ajv = new Ajv({ allErrors: true, useDefaults: true });
const validate = ajv.compile(bcForgeSchema);

/**
 * Validates a configuration object against the .bc-forge.json schema.
 */
export function validateConfig(data: unknown): ConfigValidationResult {
  if (data === null || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['Configuration must be a valid JSON object.']
    };
  }

  const valid = validate(data);
  if (!valid) {
    return {
      valid: false,
      errors: ['Configuration validation failed.']
    };
  }

  const config = data as BcForgeConfig;
  return {
    valid: true,
    errors: [],
    config: {
      version: '1.0.0',
      decimals: 7,
      network: 'testnet',
      ...config
    }
  };
}

/**
 * Loads and validates .bc-forge.json deployment configuration.
 * @param customPath Optional custom file path. Defaults to `.bc-forge.json` in the current working directory.
 */
export function loadConfigFile(customPath?: string): ConfigParseResult {
  const targetPath = customPath
    ? path.resolve(customPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

  if (!fs.existsSync(targetPath)) {
    if (customPath) {
      return {
        success: false,
        errors: [`Configuration file not found at path: ${targetPath}`],
        filePath: targetPath
      };
    }
    return {
      success: false,
      errors: [`Configuration file ${DEFAULT_CONFIG_FILENAME} not found.`],
      filePath: targetPath
    };
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(targetPath, 'utf-8');
  } catch (err: any) {
    return {
      success: false,
      errors: [`Failed to read configuration file: ${err.message}`],
      filePath: targetPath
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch (err: any) {
    return {
      success: false,
      errors: [`Invalid JSON syntax in ${path.basename(targetPath)}: ${err.message}`],
      filePath: targetPath
    };
  }

  const validation = validateConfig(parsedJson);
  if (!validation.valid) {
    return {
      success: false,
      errors: validation.errors,
      filePath: targetPath
    };
  }

  return {
    success: true,
    config: validation.config,
    filePath: targetPath
  };
}

/**
 * Saves configuration object to .bc-forge.json file after validation.
 */
export function saveConfigFile(
  config: BcForgeConfig,
  customPath?: string
): { success: boolean; filePath: string; errors?: string[] } {
  const targetPath = customPath
    ? path.resolve(customPath)
    : path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);

  const validation = validateConfig(config);
  if (!validation.valid) {
    return {
      success: false,
      filePath: targetPath,
      errors: validation.errors
    };
  }

  try {
    const jsonString = JSON.stringify(validation.config, null, 2);
    fs.writeFileSync(targetPath, jsonString, 'utf-8');
    return {
      success: true,
      filePath: targetPath
    };
  } catch (err: any) {
    return {
      success: false,
      filePath: targetPath,
      errors: [`Failed to write configuration file: ${err.message}`]
    };
  }
}
