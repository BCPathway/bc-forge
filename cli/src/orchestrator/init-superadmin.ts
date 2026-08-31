import { Keypair } from '@stellar/stellar-sdk';
import { bcForgeClient, Role } from '@bc-forge/sdk';
import logger from '../utils/logger.js';
import { loadConfigFile, saveConfigFile, BcForgeConfig } from '../utils/config-parser.js';
import { getClientConfig, getSecretKey } from '../utils/config.js';
import { InitializeSuperAdminOptions, InitializeSuperAdminResult } from './types.js';

const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Validates Stellar contract ID format (C... 56 characters)
 */
export function isValidContractId(contractId: string): boolean {
  return typeof contractId === 'string' && CONTRACT_ID_REGEX.test(contractId);
}

/**
 * Validates Stellar public key format (G... 56 characters)
 */
export function isValidStellarAddress(address: string): boolean {
  return typeof address === 'string' && STELLAR_ADDRESS_REGEX.test(address);
}

/**
 * Automatically initializes a contract with the deployer as SuperAdmin / Admin
 * and verifies the SuperAdmin role on-chain.
 *
 * @param options Initialization options
 * @returns InitializeSuperAdminResult
 */
export async function initializeSuperAdmin(
  options: InitializeSuperAdminOptions = {}
): Promise<InitializeSuperAdminResult> {
  const fileConfigResult = loadConfigFile(options.configPath);
  const fileConfig: BcForgeConfig | undefined = fileConfigResult.success ? fileConfigResult.config : undefined;

  // Resolve contract ID
  const contractId =
    options.contractId ||
    fileConfig?.contracts?.token?.contractId ||
    fileConfig?.contracts?.admin?.contractId ||
    getClientConfig().contractId;

  if (!contractId) {
    return {
      success: false,
      contractId: '',
      deployer: '',
      isSuperAdminVerified: false,
      error: 'Contract ID is required. Specify via options or present in .bc-forge.json',
    };
  }

  if (!isValidContractId(contractId)) {
    return {
      success: false,
      contractId,
      deployer: '',
      isSuperAdminVerified: false,
      error: `Invalid contract ID format: ${contractId}. Must be a valid 56-character C... Soroban contract ID.`,
    };
  }

  // Resolve signer keypair
  let deployerKeypair: Keypair | undefined = options.deployerKeypair;
  if (!deployerKeypair) {
    const secret = options.secretKey || getSecretKey();
    if (!secret) {
      return {
        success: false,
        contractId,
        deployer: '',
        isSuperAdminVerified: false,
        error: 'Deployer secret key not configured. Provide secretKey or set SECRET_KEY env variable.',
      };
    }
    try {
      deployerKeypair = Keypair.fromSecret(secret);
    } catch (err: any) {
      return {
        success: false,
        contractId,
        deployer: '',
        isSuperAdminVerified: false,
        error: `Invalid secret key provided: ${err.message}`,
      };
    }
  }

  const deployer = options.deployer || deployerKeypair.publicKey();
  if (!isValidStellarAddress(deployer)) {
    return {
      success: false,
      contractId,
      deployer,
      isSuperAdminVerified: false,
      error: `Invalid deployer address format: ${deployer}. Must be a valid 56-character G... Stellar public key.`,
    };
  }

  // Resolve network & RPC parameters
  const rpcUrl = options.rpcUrl || fileConfig?.rpcUrl || getClientConfig().rpcUrl;
  const networkPassphrase =
    options.networkPassphrase || fileConfig?.networkPassphrase || getClientConfig().networkPassphrase;

  const decimals = options.decimals ?? fileConfig?.decimals ?? 7;
  const name = options.name || fileConfig?.name || 'bc-forge Token';
  const symbol = options.symbol || fileConfig?.symbol || 'FORGE';
  const shouldVerify = options.verify !== false;

  logger.info(`Initializing contract ${contractId} with SuperAdmin: ${deployer}`);
  logger.debug(`Params: decimals=${decimals}, name="${name}", symbol="${symbol}", rpcUrl=${rpcUrl}`);

  const client = new bcForgeClient({
    rpcUrl,
    networkPassphrase,
    contractId,
  });

  let txHash: string | undefined;

  try {
    const initResult = await client.initialize(deployer, decimals, name, symbol, deployerKeypair);

    if (!initResult.success) {
      return {
        success: false,
        contractId,
        deployer,
        txHash: initResult.hash,
        isSuperAdminVerified: false,
        error: `Contract initialization transaction failed. TX: ${initResult.hash}`,
      };
    }

    txHash = initResult.hash;
    logger.success(`Contract successfully initialized on-chain. TX: ${txHash}`);
  } catch (err: any) {
    const errorMessage = err?.message || String(err);
    // If already initialized, check if current admin is already deployer
    if (errorMessage.toLowerCase().includes('already') || errorMessage.toLowerCase().includes('alreadyinitialized')) {
      logger.warn(`Contract ${contractId} is already initialized. Proceeding with on-chain role verification.`);
    } else {
      return {
        success: false,
        contractId,
        deployer,
        isSuperAdminVerified: false,
        error: `Transaction submission failed: ${errorMessage}`,
      };
    }
  }

  // On-chain SuperAdmin Verification
  let isSuperAdminVerified = false;
  let verifiedRole: Role | string = Role.SuperAdmin;

  if (shouldVerify) {
    logger.info(`Verifying SuperAdmin role for ${deployer} on-chain...`);
    try {
      isSuperAdminVerified = await client.verifySuperAdmin(deployer);

      if (isSuperAdminVerified) {
        logger.success(`Verified SuperAdmin role on-chain for deployer: ${deployer}`);
      } else {
        // Double check admin entry
        const onChainAdmin = await client.getAdmin().catch(() => undefined);
        if (onChainAdmin === deployer) {
          isSuperAdminVerified = true;
          verifiedRole = Role.Admin;
          logger.success(`Verified Admin (universal role holder) on-chain for deployer: ${deployer}`);
        } else {
          logger.error(`SuperAdmin role verification failed on-chain. Current on-chain admin: ${onChainAdmin || 'none'}`);
          return {
            success: false,
            contractId,
            deployer,
            txHash,
            isSuperAdminVerified: false,
            error: `On-chain role verification failed. Expected ${deployer} to hold SuperAdmin/Admin role.`,
          };
        }
      }
    } catch (err: any) {
      logger.warn(`Could not verify role on-chain via simulation query: ${err.message}`);
      // If the tx succeeded, treat as unverified warning
      isSuperAdminVerified = false;
    }
  } else {
    logger.debug('Skipping on-chain verification as requested.');
    isSuperAdminVerified = true;
  }

  // Update local deployment configuration file if present or provided
  if (fileConfigResult.filePath) {
    try {
      const updatedConfig: BcForgeConfig = {
        ...(fileConfig || {
          name,
          symbol,
          decimals,
          version: '1.0.0',
          network: 'testnet',
        }),
        admin: deployer,
        contracts: {
          ...(fileConfig?.contracts || {}),
          token: {
            ...(fileConfig?.contracts?.token || {}),
            contractId,
            deployer,
          },
        },
      };

      saveConfigFile(updatedConfig, fileConfigResult.filePath);
      logger.debug(`Updated configuration saved to: ${fileConfigResult.filePath}`);
    } catch (err: any) {
      logger.warn(`Failed to update configuration file: ${err.message}`);
    }
  }

  return {
    success: true,
    contractId,
    deployer,
    txHash,
    isSuperAdminVerified,
    details: {
      name,
      symbol,
      decimals,
      verifiedRole,
    },
  };
}
