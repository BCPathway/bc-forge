import { jest } from '@jest/globals';
import { Keypair } from '@stellar/stellar-sdk';
import { runDeploymentOrchestrator } from '../orchestrator.js';
import * as initModule from '../init-superadmin.js';
import * as connectModule from '../connect-contracts.js';
import * as configParser from '../../utils/config-parser.js';

const ADMIN_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1';
const TOKEN_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2';
const KEYPAIR = Keypair.random();

describe('runDeploymentOrchestrator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should successfully run the full orchestrator pipeline and return success', async () => {
    jest.spyOn(configParser, 'loadConfigFile').mockReturnValue({
      success: true,
      filePath: '/mock/.bc-forge.json',
      config: {
        name: 'ForgeApp',
        symbol: 'FAP',
        decimals: 7,
      },
    });

    jest.spyOn(initModule, 'initializeSuperAdmin').mockResolvedValue({
      success: true,
      contractId: TOKEN_ID,
      deployer: KEYPAIR.publicKey(),
      isSuperAdminVerified: true,
      txHash: 'mock-init-tx',
    });

    jest.spyOn(connectModule, 'connectContractIds').mockResolvedValue({
      success: true,
      linkedContracts: { 'token.adminContractId': ADMIN_ID },
      txHashes: { 'token.setAdminContract': 'mock-link-tx' },
      verifiedLinks: { 'token.adminContractId': true },
    });

    const result = await runDeploymentOrchestrator({
      adminContractId: ADMIN_ID,
      tokenContractId: TOKEN_ID,
      deployerKeypair: KEYPAIR,
      configPath: '/mock/.bc-forge.json',
    });

    expect(result.success).toBe(true);
    expect(result.initResult?.isSuperAdminVerified).toBe(true);
    expect(result.connectResult?.linkedContracts['token.adminContractId']).toBe(ADMIN_ID);
    expect(result.errors).toBeUndefined();
  });

  it('should report errors when step 1 or step 2 fails', async () => {
    jest.spyOn(configParser, 'loadConfigFile').mockReturnValue({
      success: false,
    });

    jest.spyOn(initModule, 'initializeSuperAdmin').mockResolvedValue({
      success: false,
      contractId: TOKEN_ID,
      deployer: KEYPAIR.publicKey(),
      isSuperAdminVerified: false,
      error: 'Simulated initialization failure',
    });

    jest.spyOn(connectModule, 'connectContractIds').mockResolvedValue({
      success: false,
      linkedContracts: {},
      txHashes: {},
      verifiedLinks: {},
      errors: ['Simulated connection failure'],
    });

    const result = await runDeploymentOrchestrator({
      adminContractId: ADMIN_ID,
      tokenContractId: TOKEN_ID,
      deployerKeypair: KEYPAIR,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});
