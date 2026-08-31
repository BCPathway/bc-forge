import { Keypair } from '@stellar/stellar-sdk';
import { Role } from '@bc-forge/sdk';

export interface InitializeSuperAdminOptions {
  /** Target contract ID to initialize (C... address) */
  contractId?: string;
  /** Deployer Stellar public key (G... address) */
  deployer?: string;
  /** Deployer secret seed key (S... address) */
  secretKey?: string;
  /** Deployer Keypair */
  deployerKeypair?: Keypair;
  /** Soroban RPC endpoint URL */
  rpcUrl?: string;
  /** Stellar network passphrase */
  networkPassphrase?: string;
  /** Token decimal precision */
  decimals?: number;
  /** Token name */
  name?: string;
  /** Token symbol */
  symbol?: string;
  /** Whether to verify the SuperAdmin role on-chain after initialization (default: true) */
  verify?: boolean;
  /** Optional custom path to .bc-forge.json */
  configPath?: string;
}

export interface InitializeSuperAdminResult {
  success: boolean;
  contractId: string;
  deployer: string;
  txHash?: string;
  isSuperAdminVerified: boolean;
  error?: string;
  details?: {
    name?: string;
    symbol?: string;
    decimals?: number;
    verifiedRole?: Role | string;
  };
}

export interface ContractLink {
  /** Source contract ID receiving the dependency */
  sourceContractId: string;
  /** Target contract ID being linked */
  targetContractId: string;
  /** Logical connection type */
  linkType: 'admin' | 'token' | 'vesting' | 'wrapper' | 'split' | string;
  /** Setup function name to invoke */
  setupFunction?: string;
}

export interface ConnectContractIdsOptions {
  /** Deployed Admin Contract ID */
  adminContractId?: string;
  /** Deployed Token Contract ID */
  tokenContractId?: string;
  /** Deployed Vesting Contract ID */
  vestingContractId?: string;
  /** Deployed Wrapper Contract ID */
  wrapperContractId?: string;
  /** Custom contract links */
  customLinks?: ContractLink[];
  /** Deployer / Admin secret key */
  secretKey?: string;
  /** Deployer / Admin Keypair */
  deployerKeypair?: Keypair;
  /** Soroban RPC endpoint URL */
  rpcUrl?: string;
  /** Stellar network passphrase */
  networkPassphrase?: string;
  /** Path to .bc-forge.json to update */
  configPath?: string;
  /** Whether to verify connections on-chain */
  verify?: boolean;
}

export interface ConnectContractIdsResult {
  success: boolean;
  linkedContracts: Record<string, string>;
  txHashes: Record<string, string>;
  verifiedLinks: Record<string, boolean>;
  errors?: string[];
}

export interface DeploymentOrchestratorOptions {
  configPath?: string;
  secretKey?: string;
  deployerKeypair?: Keypair;
  rpcUrl?: string;
  networkPassphrase?: string;
  adminContractId?: string;
  tokenContractId?: string;
  vestingContractId?: string;
  wrapperContractId?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  skipVerify?: boolean;
}

export interface DeploymentOrchestratorResult {
  success: boolean;
  initResult?: InitializeSuperAdminResult;
  connectResult?: ConnectContractIdsResult;
  configPath?: string;
  errors?: string[];
}
