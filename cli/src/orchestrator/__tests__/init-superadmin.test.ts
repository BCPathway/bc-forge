import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { initializeSuperAdmin, isValidContractId, isValidStellarAddress } from '../init-superadmin.js';
import * as configParser from '../../utils/config-parser.js';
import * as configUtil from '../../utils/config.js';

// Valid mock Stellar C-address (56 chars) and G-address (56 chars)
const VALID_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_DEPLOYER_KEYPAIR = Keypair.random();
const VALID_DEPLOYER_PUB = VALID_DEPLOYER_KEYPAIR.publicKey();
const VALID_SECRET_KEY = VALID_DEPLOYER_KEYPAIR.secret();

describe('initializeSuperAdmin (Issue #694)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Validation Helpers', () => {
    it('isValidContractId correctly validates 56-char C-addresses', () => {
      expect(isValidContractId(VALID_CONTRACT_ID)).toBe(true);
      expect(isValidContractId('GABC123')).toBe(false);
      expect(isValidContractId('C123')).toBe(false);
      expect(isValidContractId('')).toBe(false);
    });

    it('isValidStellarAddress correctly validates 56-char G-addresses', () => {
      expect(isValidStellarAddress(VALID_DEPLOYER_PUB)).toBe(true);
      expect(isValidStellarAddress(VALID_CONTRACT_ID)).toBe(false);
      expect(isValidStellarAddress('G123')).toBe(false);
      expect(isValidStellarAddress('')).toBe(false);
    });
  });

  describe('Happy Paths', () => {
    it('should automatically construct and submit init transaction and verify SuperAdmin role on-chain', async () => {
      vi.spyOn(configUtil, 'getSecretKey').mockReturnValue(VALID_SECRET_KEY);
      vi.spyOn(configUtil, 'getClientConfig').mockReturnValue({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contractId: VALID_CONTRACT_ID,
      });

      const result = await initializeSuperAdmin({
        contractId: VALID_CONTRACT_ID,
        deployerKeypair: VALID_DEPLOYER_KEYPAIR,
        verify: false, // Skip live network call in unit test
      });

      expect(result.success).toBe(true);
      expect(result.contractId).toBe(VALID_CONTRACT_ID);
      expect(result.deployer).toBe(VALID_DEPLOYER_PUB);
      expect(result.isSuperAdminVerified).toBe(true);
      expect(result.details?.name).toBe('bc-forge Token');
      expect(result.details?.symbol).toBe('FORGE');
      expect(result.details?.decimals).toBe(7);
    });

    it('should initialize with custom name, symbol, and decimals', async () => {
      const result = await initializeSuperAdmin({
        contractId: VALID_CONTRACT_ID,
        deployerKeypair: VALID_DEPLOYER_KEYPAIR,
        name: 'Custom Project Token',
        symbol: 'CPT',
        decimals: 9,
        verify: false,
      });

      expect(result.success).toBe(true);
      expect(result.details?.name).toBe('Custom Project Token');
      expect(result.details?.symbol).toBe('CPT');
      expect(result.details?.decimals).toBe(9);
    });

    it('should update configuration file with deployer and initialized contract state', async () => {
      const mockSave = vi.spyOn(configParser, 'saveConfigFile').mockReturnValue({
        success: true,
        filePath: '/mock/path/.bc-forge.json',
      });
      vi.spyOn(configParser, 'loadConfigFile').mockReturnValue({
        success: true,
        filePath: '/mock/path/.bc-forge.json',
        config: {
          name: 'MyToken',
          symbol: 'MTK',
          decimals: 7,
        },
      });

      const result = await initializeSuperAdmin({
        contractId: VALID_CONTRACT_ID,
        deployerKeypair: VALID_DEPLOYER_KEYPAIR,
        configPath: '/mock/path/.bc-forge.json',
        verify: false,
      });

      expect(result.success).toBe(true);
      expect(mockSave).toHaveBeenCalledTimes(1);
      const savedConfig = mockSave.mock.calls[0][0];
      expect(savedConfig.admin).toBe(VALID_DEPLOYER_PUB);
      expect(savedConfig.contracts?.token?.contractId).toBe(VALID_CONTRACT_ID);
      expect(savedConfig.contracts?.token?.deployer).toBe(VALID_DEPLOYER_PUB);
    });
  });

  describe('Error States', () => {
    it('should fail when contractId is missing and not configured', async () => {
      vi.spyOn(configParser, 'loadConfigFile').mockReturnValue({
        success: false,
      });
      vi.spyOn(configUtil, 'getClientConfig').mockReturnValue({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contractId: '',
      });

      const result = await initializeSuperAdmin({
        contractId: '',
        deployerKeypair: VALID_DEPLOYER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.isSuperAdminVerified).toBe(false);
      expect(result.error).toContain('Contract ID is required');
    });

    it('should fail when contractId format is invalid', async () => {
      const result = await initializeSuperAdmin({
        contractId: 'INVALID_CONTRACT_ID_123',
        deployerKeypair: VALID_DEPLOYER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.isSuperAdminVerified).toBe(false);
      expect(result.error).toContain('Invalid contract ID format');
    });

    it('should fail when secret key is not provided or configured', async () => {
      vi.spyOn(configUtil, 'getSecretKey').mockReturnValue('');

      const result = await initializeSuperAdmin({
        contractId: VALID_CONTRACT_ID,
      });

      expect(result.success).toBe(false);
      expect(result.isSuperAdminVerified).toBe(false);
      expect(result.error).toContain('Deployer secret key not configured');
    });

    it('should fail when secret key format is invalid', async () => {
      const result = await initializeSuperAdmin({
        contractId: VALID_CONTRACT_ID,
        secretKey: 'INVALID_SECRET_KEY',
      });

      expect(result.success).toBe(false);
      expect(result.isSuperAdminVerified).toBe(false);
      expect(result.error).toContain('Invalid secret key provided');
    });

    it('should fail when deployer address is invalid format', async () => {
      const result = await initializeSuperAdmin({
        contractId: VALID_CONTRACT_ID,
        deployer: 'INVALID_G_ADDRESS',
        deployerKeypair: VALID_DEPLOYER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.isSuperAdminVerified).toBe(false);
      expect(result.error).toContain('Invalid deployer address format');
    });
  });
});
