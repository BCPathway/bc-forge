import logger from '../utils/logger.js';
import { loadConfigFile, BcForgeConfig } from '../utils/config-parser.js';
import { initializeSuperAdmin } from './init-superadmin.js';
import { connectContractIds } from './connect-contracts.js';
import {
  DeploymentOrchestratorOptions,
  DeploymentOrchestratorResult,
} from './types.js';

/**
 * Runs the complete CLI deployment orchestrator workflow:
 * 1. Initialize SuperAdmin natively on-chain with deployer credentials
 * 2. Connect and link deployed contract IDs (Admin -> Token, Token -> Vesting/Wrapper)
 * 3. Verify on-chain SuperAdmin roles and contract relationships
 * 4. Persist deployment state to .bc-forge.json
 *
 * @param options Deployment orchestrator options
 * @returns DeploymentOrchestratorResult
 */
export async function runDeploymentOrchestrator(
  options: DeploymentOrchestratorOptions = {}
): Promise<DeploymentOrchestratorResult> {
  const errors: string[] = [];
  logger.info('====================================================');
  logger.info('   bc-forge CLI Deployment Orchestrator Running     ');
  logger.info('====================================================');

  const fileConfigResult = loadConfigFile(options.configPath);
  const fileConfig: BcForgeConfig | undefined = fileConfigResult.success ? fileConfigResult.config : undefined;

  const contractId =
    options.tokenContractId ||
    fileConfig?.contracts?.token?.contractId ||
    fileConfig?.contracts?.admin?.contractId;

  // ── Step 1: Initialize SuperAdmin Natively ───────────────────────────────
  logger.info('\n[Step 1/2] Initializing SuperAdmin natively...');
  const initResult = await initializeSuperAdmin({
    contractId,
    secretKey: options.secretKey,
    deployerKeypair: options.deployerKeypair,
    rpcUrl: options.rpcUrl,
    networkPassphrase: options.networkPassphrase,
    name: options.name,
    symbol: options.symbol,
    decimals: options.decimals,
    verify: !options.skipVerify,
    configPath: options.configPath,
  });

  if (!initResult.success) {
    logger.error(`SuperAdmin initialization failed: ${initResult.error}`);
    errors.push(`SuperAdmin initialization failed: ${initResult.error}`);
  } else {
    logger.success(`SuperAdmin initialized: ${initResult.deployer}`);
    if (initResult.isSuperAdminVerified) {
      logger.success(`Verified SuperAdmin role on-chain: TRUE`);
    } else {
      logger.warn(`On-chain SuperAdmin role could not be verified automatically.`);
    }
  }

  // ── Step 2: Connect Contract IDs Post-Deployment ──────────────────────────
  logger.info('\n[Step 2/2] Connecting deployed contract IDs post-deployment...');
  const connectResult = await connectContractIds({
    adminContractId: options.adminContractId || fileConfig?.contracts?.admin?.contractId,
    tokenContractId: initResult.contractId || contractId,
    vestingContractId: options.vestingContractId || fileConfig?.contracts?.vesting?.contractId,
    wrapperContractId: options.wrapperContractId || fileConfig?.contracts?.wrapper?.contractId,
    secretKey: options.secretKey,
    deployerKeypair: options.deployerKeypair,
    rpcUrl: options.rpcUrl,
    networkPassphrase: options.networkPassphrase,
    verify: !options.skipVerify,
    configPath: options.configPath,
  });

  if (!connectResult.success && connectResult.errors) {
    connectResult.errors.forEach(err => errors.push(err));
  } else {
    logger.success(`Contract IDs successfully connected.`);
    Object.entries(connectResult.linkedContracts).forEach(([k, v]) => {
      logger.info(`  - ${k} -> ${v}`);
    });
  }

  const overallSuccess = errors.length === 0 && initResult.success;

  logger.info('====================================================');
  if (overallSuccess) {
    logger.success('   Deployment Orchestrator Completed Successfully!   ');
  } else {
    logger.error('   Deployment Orchestrator Completed with Errors.   ');
  }
  logger.info('====================================================');

  return {
    success: overallSuccess,
    initResult,
    connectResult,
    configPath: fileConfigResult.filePath,
    errors: errors.length > 0 ? errors : undefined,
  };
}
