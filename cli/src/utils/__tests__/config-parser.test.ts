import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
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

  describe('validateConfig', () => {
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

    it('should fail validation when required fields (name, symbol) are missing', () => {
      const invalidData = {
        decimals: 18
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('must have required property'))).toBe(true);
    });

    it('should fail validation when data types are incorrect', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        decimals: 'seven' // should be integer
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('decimals'))).toBe(true);
    });

    it('should fail validation when Stellar admin address pattern is invalid', () => {
      const invalidData = {
        name: 'Test Token',
        symbol: 'TTK',
        admin: 'INVALID_STELLAR_ADDRESS'
      };

      const result = validateConfig(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('admin'))).toBe(true);
    });

    it('should fail validation for non-object values', () => {
      const result = validateConfig('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Configuration must be a valid JSON object.');
    });
  });

  describe('loadConfigFile', () => {
    it('should return error when specified config file does not exist', () => {
      const nonExistentPath = path.join(tmpDir, 'non-existent.json');
      const result = loadConfigFile(nonExistentPath);

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Configuration file not found');
    });

    it('should return error when configuration file contains invalid JSON syntax', () => {
      const badJsonPath = path.join(tmpDir, '.bc-forge.json');
      fs.writeFileSync(badJsonPath, '{ invalid json content: true, }');

      const result = loadConfigFile(badJsonPath);
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid JSON syntax');
    });

    it('should load and parse a valid config file successfully (happy path)', () => {
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
  });

  describe('saveConfigFile', () => {
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

    it('should reject saving invalid configuration', () => {
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
  });
});
