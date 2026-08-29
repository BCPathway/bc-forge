import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import logger from './logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ContractDeploymentArtifact {
  contractId: string;
  wasmHash?: string;
  txHash?: string;
  deployedAt?: string;
  [key: string]: unknown;
}

export interface DeploymentArtifacts {
  version?: string;
  network?: string;
  rpcUrl?: string;
  timestamp: string;
  contracts: Record<string, ContractDeploymentArtifact>;
  txHashes?: Record<string, string>;
  [key: string]: unknown;
}

export interface ExportDeploymentsOptions {
  /** Target file path for JSON export (default: 'deployments.json'). */
  targetPath?: string;
  /** Whether to format JSON with 2-space indentation (default: true). */
  pretty?: boolean;
}

export interface ExportDeploymentsResult {
  success: boolean;
  filePath: string;
  error?: string;
}

export interface BuildDeploymentArtifactsInput {
  network?: string;
  rpcUrl?: string;
  vaultContractId?: string;
  vaultWasmHash?: string;
  feeContractId?: string;
  feeWasmHash?: string;
  linkTxHash?: string;
  contracts?: Record<string, ContractDeploymentArtifact>;
  txHashes?: Record<string, string>;
}

// ─── Core Export & Atomic Write Utilities ────────────────────────────────────

/**
 * Builds a standardized DeploymentArtifacts object from input contract details.
 */
export function buildDeploymentArtifacts(input: BuildDeploymentArtifactsInput): DeploymentArtifacts {
  const timestamp = new Date().toISOString();
  const contracts: Record<string, ContractDeploymentArtifact> = {
    ...(input.contracts || {}),
  };

  if (input.vaultContractId) {
    contracts.vault = {
      contractId: input.vaultContractId,
      ...(input.vaultWasmHash ? { wasmHash: input.vaultWasmHash } : {}),
      deployedAt: timestamp,
    };
  }

  if (input.feeContractId) {
    contracts.fee = {
      contractId: input.feeContractId,
      ...(input.feeWasmHash ? { wasmHash: input.feeWasmHash } : {}),
      deployedAt: timestamp,
    };
  }

  const txHashes: Record<string, string> = {
    ...(input.txHashes || {}),
  };

  if (input.linkTxHash) {
    txHashes.linkTxHash = input.linkTxHash;
  }

  return {
    version: '1.0.0',
    ...(input.network ? { network: input.network } : {}),
    ...(input.rpcUrl ? { rpcUrl: input.rpcUrl } : {}),
    timestamp,
    contracts,
    ...(Object.keys(txHashes).length > 0 ? { txHashes } : {}),
  };
}

/**
 * Safely writes deployment artifacts JSON to a file using atomic write + rename.
 * This guarantees that overwrites will never corrupt an existing deployments file if
 * an error or crash occurs during writing.
 */
export function exportDeploymentsToFile(
  artifacts: DeploymentArtifacts,
  targetPath: string = 'deployments.json',
  options: ExportDeploymentsOptions = {}
): ExportDeploymentsResult {
  const resolvedPath = path.resolve(targetPath);
  const pretty = options.pretty ?? true;
  const jsonContent = JSON.stringify(artifacts, null, pretty ? 2 : undefined);

  const dir = path.dirname(resolvedPath);

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err: any) {
    const errorMsg = `Failed to create destination directory: ${err.message}`;
    logger.error(errorMsg);
    return {
      success: false,
      filePath: resolvedPath,
      error: errorMsg,
    };
  }

  // Atomic write setup: write to temp file first in the same directory
  const tempFileName = `.deployments.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const tempPath = path.join(dir, tempFileName);

  try {
    const fd = fs.openSync(tempPath, 'w');
    try {
      fs.writeFileSync(fd, jsonContent, 'utf-8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    // Atomic rename over target file
    fs.renameSync(tempPath, resolvedPath);
    logger.info(`Saved deployment artifacts safely to ${resolvedPath}`);

    return {
      success: true,
      filePath: resolvedPath,
    };
  } catch (err: any) {
    // Clean up temporary file if it still exists
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore cleanup error
      }
    }
    const errorMsg = `Failed to write deployment file atomically: ${err.message}`;
    logger.error(errorMsg);
    return {
      success: false,
      filePath: resolvedPath,
      error: errorMsg,
    };
  }
}

/**
 * Loads deployment artifacts from a JSON file.
 */
export function loadDeploymentsFromFile(targetPath: string = 'deployments.json'): {
  success: boolean;
  artifacts?: DeploymentArtifacts;
  error?: string;
  filePath: string;
} {
  const resolvedPath = path.resolve(targetPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      success: false,
      filePath: resolvedPath,
      error: `Deployment file not found at ${resolvedPath}`,
    };
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const parsed = JSON.parse(content) as DeploymentArtifacts;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.contracts) {
      return {
        success: false,
        filePath: resolvedPath,
        error: `Invalid deployment JSON schema at ${resolvedPath}`,
      };
    }
    return {
      success: true,
      artifacts: parsed,
      filePath: resolvedPath,
    };
  } catch (err: any) {
    return {
      success: false,
      filePath: resolvedPath,
      error: `Failed to read or parse deployment file: ${err.message}`,
    };
  }
}
