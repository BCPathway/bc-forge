import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { connectContractIds, linkContracts } from '../connect-contracts.js';
import * as configParser from '../../utils/config-parser.js';
import * as configUtil from '../../utils/config.js';

const ADMIN_CONTRACT_ID = `C${'A'.repeat(54)}B`;
const TOKEN_CONTRACT_ID = `C${'A'.repeat(54)}C`;
const VESTING_CONTRACT_ID = `C${'A'.repeat(54)}D`;
const WRAPPER_CONTRACT_ID = `C${'A'.repeat(54)}E`;
const SIGNER_KEYPAIR = Keypair.random();
const SIGNER_SECRET = SIGNER_KEYPAIR.secret();

describe('connectContractIds (Issue #693)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Happy Paths', () => {
    it('should successfully link Admin Contract ID to Token Contract', async () => {
      vi.spyOn(configUtil, 'getSecretKey').mockReturnValue(SIGNER_SECRET);

      const result = await connectContractIds({
        adminContractId: ADMIN_CONTRACT_ID,
        tokenContractId: TOKEN_CONTRACT_ID,
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(true);
      expect(result.linkedContracts['token.adminContractId']).toBe(ADMIN_CONTRACT_ID);
      expect(result.verifiedLinks['token.adminContractId']).toBe(true);
    });

    it('should successfully link Token Contract ID to Vesting and Wrapper dependent contracts', async () => {
      const result = await connectContractIds({
        tokenContractId: TOKEN_CONTRACT_ID,
        vestingContractId: VESTING_CONTRACT_ID,
        wrapperContractId: WRAPPER_CONTRACT_ID,
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(true);
      expect(result.linkedContracts['vesting.tokenContractId']).toBe(TOKEN_CONTRACT_ID);
      expect(result.linkedContracts['wrapper.tokenContractId']).toBe(TOKEN_CONTRACT_ID);
      expect(result.verifiedLinks['vesting.tokenContractId']).toBe(true);
      expect(result.verifiedLinks['wrapper.tokenContractId']).toBe(true);
    });

    it('should support custom contract links', async () => {
      const result = await connectContractIds({
        customLinks: [
          {
            sourceContractId: TOKEN_CONTRACT_ID,
            targetContractId: ADMIN_CONTRACT_ID,
            linkType: 'adminGovernance',
          },
        ],
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(true);
      expect(result.linkedContracts[`adminGovernance.${TOKEN_CONTRACT_ID}`]).toBe(ADMIN_CONTRACT_ID);
    });

    it('should persist all linked contract IDs to .bc-forge.json deployment config', async () => {
      const mockSave = vi.spyOn(configParser, 'saveConfigFile').mockReturnValue({
        success: true,
        filePath: '/mock/.bc-forge.json',
      });
      vi.spyOn(configParser, 'loadConfigFile').mockReturnValue({
        success: true,
        filePath: '/mock/.bc-forge.json',
        config: {
          name: 'MyProject',
          symbol: 'PRJ',
          decimals: 7,
          contracts: {
            token: { contractId: TOKEN_CONTRACT_ID },
            admin: { contractId: ADMIN_CONTRACT_ID },
          },
        },
      });

      const result = await linkContracts({
        adminContractId: ADMIN_CONTRACT_ID,
        tokenContractId: TOKEN_CONTRACT_ID,
        vestingContractId: VESTING_CONTRACT_ID,
        wrapperContractId: WRAPPER_CONTRACT_ID,
        deployerKeypair: SIGNER_KEYPAIR,
        configPath: '/mock/.bc-forge.json',
      });

      expect(result.success).toBe(true);
      expect(mockSave).toHaveBeenCalledTimes(1);

      const savedConfig = mockSave.mock.calls[0][0];
      expect(savedConfig.contracts?.token?.adminContractId).toBe(ADMIN_CONTRACT_ID);
      expect(savedConfig.contracts?.vesting?.tokenContractId).toBe(TOKEN_CONTRACT_ID);
      expect(savedConfig.contracts?.wrapper?.tokenContractId).toBe(TOKEN_CONTRACT_ID);
    });
  });

  describe('Error States', () => {
    it('should fail when no contract IDs are provided or found in config', async () => {
      vi.spyOn(configParser, 'loadConfigFile').mockReturnValue({ success: false });
      vi.spyOn(configUtil, 'getClientConfig').mockReturnValue({
        rpcUrl: 'https://soroban-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        contractId: '',
      });

      const result = await connectContractIds({});

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('No contract IDs provided to connect');
    });

    it('should fail when Admin Contract ID format is invalid', async () => {
      const result = await connectContractIds({
        adminContractId: 'INVALID_ADMIN_ID',
        tokenContractId: TOKEN_CONTRACT_ID,
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid Admin Contract ID format');
    });

    it('should fail when Token Contract ID format is invalid', async () => {
      const result = await connectContractIds({
        adminContractId: ADMIN_CONTRACT_ID,
        tokenContractId: 'INVALID_TOKEN_ID',
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid Token Contract ID format');
    });

    it('should fail when Vesting Contract ID format is invalid', async () => {
      const result = await connectContractIds({
        tokenContractId: TOKEN_CONTRACT_ID,
        vestingContractId: 'INVALID_VESTING_ID',
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid Vesting Contract ID format');
    });

    it('should fail when Wrapper Contract ID format is invalid', async () => {
      const result = await connectContractIds({
        tokenContractId: TOKEN_CONTRACT_ID,
        wrapperContractId: 'INVALID_WRAPPER_ID',
        deployerKeypair: SIGNER_KEYPAIR,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid Wrapper Contract ID format');
    });

    it('should fail when deployer secret key is not provided or configured', async () => {
      vi.spyOn(configUtil, 'getSecretKey').mockReturnValue('');

      const result = await connectContractIds({
        adminContractId: ADMIN_CONTRACT_ID,
        tokenContractId: TOKEN_CONTRACT_ID,
      });

      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain('Deployer/Admin secret key not configured');
    });
  });
});
