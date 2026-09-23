import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  validateConfig,
  loadConfigFile,
  saveConfigFile,
  BcForgeConfig
} from '../config-parser.js';

describe('.bc-forge.json Config Parser & Schema Validation (#686)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-forge-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateConfig - Happy Paths', () => {
    it('should validate a valid configuration object and apply default values', () => {
      const validData = {
        name: 'Test Token',
        symbol: 'TTK',
        admin: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      };

      const result = validateConfig(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config).toBeDefined();
      expect(result.config?.name).toBe('Test Token');
      expect(result.config?.decimals).toBe(7);
      expect(result.config?.network).toBe('testnet');
      expect(result.config?.version).toBe('1.0.0');
    });

    it('should validate config with all optional fields present', () => {
      const fullConfig = {
        version: '1.0.0',
        name: 'Complete Token',
        symbol: 'CTK',
        decimals: 18,
        admin: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYCZLYC3W46XYD3NEFA',
        network: 'mainnet',
        rpcUrl: 'https://soroban-mainnet.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        secretKey: 'SBUWH7DBNRVRQU5VIE7BQRHLROFLJKU2MFRWYJOWABLEEBKMBNZ5HSL7',
        contracts: {
          token: {
            contractId: 'CBBD47AB3E5F6D90FD89FDF5E99535DE3B5F7FA4C8B34E5DB32D1B7C5F8E4D2A',
            wasmHash: 'abc123def456',
            deployer: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYCZLYC3W46XYD3NEFA'
          }
        }
      };

      const result = validateConfig(fullConfig);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.config?.network).toBe('mainnet');
    });
  });

  describe('validateConfig - Missing Required Fields', () => {
    it('should fail validation when "name" field is missing', () => {
      const invalidData = {
        symbol: 'TTK'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.toLowerCase().includes('name'))).toBe(true);
    });

    it('should fail validation when "symbol" field is missing', () => {
      const invalidData = {
        name: 'Test Token'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.toLowerCase().includes('symbol'))).toBe(true);
    });

    it('should fail validation when both required fields are missing', () => {
      const invalidData = {
        decimals: 18,
        network: 'testnet'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('validateConfig - Type Mismatches', () => {
    it('should fail validation when decimals is a string instead of integer', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        decimals: 'seven'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('decimals'))).toBe(true);
    });

    it('should fail validation when decimals is a float', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        decimals: 7.5
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });

    it('should fail validation when name is not a string', () => {
      const invalidData = {
        name: 123,
        symbol: 'TTK'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });

    it('should fail validation when symbol is not a string', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: ['T', 'T', 'K']
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });

    it('should fail validation when contracts is not an object', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        contracts: 'not-an-object'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateConfig - Invalid Patterns and Ranges', () => {
    it('should fail validation for invalid Stellar admin address (wrong prefix)', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        admin: 'SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('admin'))).toBe(true);
    });

    it('should fail validation for invalid Stellar admin address (too short)', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        admin: 'GABC'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });

    it('should fail validation for invalid secret key (wrong prefix)', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        secretKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('secretkey'))).toBe(true);
    });

    it('should fail validation when decimals exceeds maximum of 18', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        decimals: 19
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });

    it('should fail validation when decimals is negative', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        decimals: -1
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
    });

    it('should fail validation for invalid network enum value', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        network: 'invalid-network'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('network'))).toBe(true);
    });

    it('should accept valid network enum values', () => {
      const networks = ['mainnet', 'testnet', 'futurenet', 'standalone', 'custom'];
      
      for (const network of networks) {
        const data = {
          name: 'Test Token',
          symbol: 'TTK',
          network
        };

        const result = validateConfig(data);
        expect(result.valid).toBe(true, `Network "${network}" should be valid`);
      }
    });
  });

  describe('validateConfig - Non-Object Inputs', () => {
    it('should fail validation for non-object values (string)', () => {
      const result = validateConfig('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Configuration must be a valid JSON object, got string');
    });

    it('should fail validation for non-object values (number)', () => {
      const result = validateConfig(42);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be a valid JSON object');
    });

    it('should fail validation for null', () => {
      const result = validateConfig(null);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be a valid JSON object');
    });

    it('should fail validation for array instead of object', () => {
      const result = validateConfig(['name', 'symbol']);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.toLowerCase().includes('array'))).toBe(true);
    });

    it('should fail validation for undefined', () => {
      const result = validateConfig(undefined);
      expect(result.valid).toBe(false);
    });
  });

  describe('loadConfigFile - Happy Paths', () => {
    it('should load and parse a valid config file successfully', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      const validConfig: BcForgeConfig = {
        name: 'Forge Token',
        symbol: 'FORGE',
        decimals: 9,
        network: 'futurenet',
        admin: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYCZLYC3W46XYD3NEFA'
      };

      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2));

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(true);
      expect(result.config?.name).toBe('Forge Token');
      expect(result.config?.symbol).toBe('FORGE');
      expect(result.config?.decimals).toBe(9);
      expect(result.config?.network).toBe('futurenet');
    });

    it('should load config with minimum required fields', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      const minimalConfig = {
        name: 'Minimal',
        symbol: 'MIN'
      };

      fs.writeFileSync(configPath, JSON.stringify(minimalConfig));

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(true);
      expect(result.config?.name).toBe('Minimal');
    });
  });

  describe('loadConfigFile - File Read Errors', () => {
    it('should return error when specified config file does not exist', () => {
      const nonExistentPath = path.join(tmpDir, 'non-existent.json');
      const result = loadConfigFile(nonExistentPath);

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Configuration file not found');
    });

    it('should return error when file cannot be read (permission denied)', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(configPath, '{ "name": "test", "symbol": "T" }');
      fs.chmodSync(configPath, 0o000);

      try {
        const result = loadConfigFile(configPath);
        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('Failed to read');
      } finally {
        fs.chmodSync(configPath, 0o644);
      }
    });
  });

  describe('loadConfigFile - Malformed JSON', () => {
    it('should return error for invalid JSON syntax (unclosed brace)', () => {
      const badJsonPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(badJsonPath, '{ "name": "test", "symbol": "T"');

      const result = loadConfigFile(badJsonPath);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid JSON syntax');
    });

    it('should return error for invalid JSON syntax (trailing comma)', () => {
      const badJsonPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(badJsonPath, '{ "name": "test", "symbol": "T", }');

      const result = loadConfigFile(badJsonPath);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid JSON syntax');
    });

    it('should return error for empty JSON', () => {
      const badJsonPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(badJsonPath, '');

      const result = loadConfigFile(badJsonPath);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid JSON syntax');
    });

    it('should return error for JSON with unquoted keys', () => {
      const badJsonPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(badJsonPath, '{ name: "test", symbol: "T" }');

      const result = loadConfigFile(badJsonPath);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid JSON syntax');
    });

    it('should return error for JSON array instead of object', () => {
      const badJsonPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(badJsonPath, '["name", "symbol"]');

      const result = loadConfigFile(badJsonPath);
      expect(result.success).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });
  });

  describe('loadConfigFile - Schema Validation Errors', () => {
    it('should return error for missing required "name" field', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(configPath, '{ "symbol": "T" }');

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.toLowerCase().includes('name'))).toBe(true);
    });

    it('should return error for missing required "symbol" field', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(configPath, '{ "name": "Test" }');

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.toLowerCase().includes('symbol'))).toBe(true);
    });

    it('should return error for invalid field types in JSON', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(configPath, '{ "name": "Test", "symbol": "T", "decimals": "invalid" }');

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(false);
      expect(result.errors?.length).toBeGreaterThan(0);
    });

    it('should return error for invalid Stellar address in loaded config', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(configPath, '{ "name": "Test", "symbol": "T", "admin": "NOTAVALIDADDRESS" }');

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.toLowerCase().includes('admin'))).toBe(true);
    });

    it('should return error for invalid network enum in loaded config', () => {
      const configPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(configPath, '{ "name": "Test", "symbol": "T", "network": "badnetwork" }');

      const result = loadConfigFile(configPath);
      expect(result.success).toBe(false);
      expect(result.errors?.some(e => e.toLowerCase().includes('network'))).toBe(true);
    });
  });

  describe('saveConfigFile - Happy Paths', () => {
    it('should save valid configuration to disk', () => {
      const savePath = path.join(tmpDir, '.bc-forge.json');
      const configToSave: BcForgeConfig = {
        name: 'Saved Token',
        symbol: 'STK'
      };

      const result = saveConfigFile(configToSave, savePath);
      expect(result.success).toBe(true);
      expect(fs.existsSync(savePath)).toBe(true);

      const loaded = loadConfigFile(savePath);
      expect(loaded.success).toBe(true);
      expect(loaded.config?.name).toBe('Saved Token');
    });

    it('should save and preserve all config fields', () => {
      const savePath = path.join(tmpDir, '.bc-forge.json');
      const configToSave: BcForgeConfig = {
        name: 'Complete Token',
        symbol: 'CTK',
        decimals: 18,
        network: 'mainnet',
        admin: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFXYCZLYC3W46XYD3NEFA',
        rpcUrl: 'https://soroban-mainnet.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015'
      };

      const result = saveConfigFile(configToSave, savePath);
      expect(result.success).toBe(true);

      const loaded = loadConfigFile(savePath);
      expect(loaded.success).toBe(true);
      expect(loaded.config?.decimals).toBe(18);
      expect(loaded.config?.network).toBe('mainnet');
    });
  });

  describe('saveConfigFile - Validation Before Save', () => {
    it('should reject saving invalid configuration (missing required fields)', () => {
      const savePath = path.join(tmpDir, '.bc-forge.json');
      const invalidConfig = { name: 'Only Name' } as any;

      const result = saveConfigFile(invalidConfig, savePath);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(fs.existsSync(savePath)).toBe(false);
    });

    it('should validate and save configuration with deployed and linked contracts', () => {
      const savePath = path.join(tmpDir, '.bc-forge.json');
      const configWithContracts: BcForgeConfig = {
        name: 'Linked Token',
        symbol: 'LTK',
        contracts: {
          token: {
            contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2',
            adminContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
            linkedContracts: {
              admin: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
            },
          },
          vesting: {
            contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3',
            tokenContractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2',
          },
        },
      };

      const result = saveConfigFile(configWithContracts, savePath);
      expect(result.success).toBe(true);

      const loaded = loadConfigFile(savePath);
      expect(loaded.success).toBe(true);
      expect(loaded.config?.contracts?.token?.adminContractId).toBe(
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
      );
      expect(loaded.config?.contracts?.vesting?.tokenContractId).toBe(
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2',
      );
    });

    it('should reject saving config with invalid type in decimals', () => {
      const savePath = path.join(tmpDir, '.bc-forge.json');
      const invalidConfig = {
        name: 'Test',
        symbol: 'T',
        decimals: 'not-a-number'
      } as any;

      const result = saveConfigFile(invalidConfig, savePath);
      expect(result.success).toBe(false);
      expect(fs.existsSync(savePath)).toBe(false);
    });

    it('should reject saving config with invalid Stellar address', () => {
      const savePath = path.join(tmpDir, '.bc-forge.json');
      const invalidConfig = {
        name: 'Test',
        symbol: 'T',
        admin: 'INVALID'
      };

      const result = saveConfigFile(invalidConfig, savePath);
      expect(result.success).toBe(false);
      expect(fs.existsSync(savePath)).toBe(false);
    });
  });
});

