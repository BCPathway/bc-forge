import { Command } from 'commander';
import { addNetworkOptions, explicitNetworkOverrides } from '../network.js';
import { getClientConfig, loadConfigFile } from '../utils/config.js';
import {
  buildDeploymentArtifacts,
  exportDeploymentsToFile,
  ContractDeploymentArtifact,
} from '../utils/deployments.js';
import logger from '../utils/logger.js';

export interface ExportDeploymentsCommandOptions {
  out: string;
  config?: string;
  vaultId?: string;
  feeId?: string;
  txHash?: string;
  network?: string;
}

export function createExportDeploymentsCommand(): Command {
  const cmd = new Command('export-deployments')
    .alias('export')
    .description('Export deployed contract IDs and transaction hashes to deployments.json')
    .option('-o, --out <path>', 'Output JSON artifact path', 'deployments.json')
    .option('-c, --config <file>', 'Path to deployment config file (e.g. .bc-forge.json)')
    .option('--vault-id <id>', 'Vault contract ID')
    .option('--fee-id <id>', 'Fee contract ID')
    .option('--tx-hash <hash>', 'Transaction hash to include');

  addNetworkOptions(cmd);

  cmd.action(async (opts: ExportDeploymentsCommandOptions, command) => {
    try {
      const netCfg = getClientConfig(explicitNetworkOverrides(command));
      const fileResult = loadConfigFile(opts.config);

      const contracts: Record<string, ContractDeploymentArtifact> = {};

      // If .bc-forge.json is loaded, copy any contracts configured in it
      if (fileResult.success && fileResult.config?.contracts) {
        for (const [name, contractData] of Object.entries(fileResult.config.contracts)) {
          if (contractData && typeof contractData === 'object') {
            contracts[name] = {
              contractId: (contractData as any).contractId || '',
              wasmHash: (contractData as any).wasmHash,
              deployedAt: new Date().toISOString(),
            };
          }
        }
      }

      // Incorporate direct CLI option overrides
      if (opts.vaultId) {
        contracts.vault = {
          ...(contracts.vault || {}),
          contractId: opts.vaultId,
          deployedAt: new Date().toISOString(),
        };
      }

      if (opts.feeId) {
        contracts.fee = {
          ...(contracts.fee || {}),
          contractId: opts.feeId,
          deployedAt: new Date().toISOString(),
        };
      }

      const txHashes: Record<string, string> = {};
      if (opts.txHash) {
        txHashes.exportTxHash = opts.txHash;
      }

      const artifacts = buildDeploymentArtifacts({
        network: netCfg.network,
        rpcUrl: netCfg.rpcUrl,
        contracts,
        txHashes,
      });

      const exportResult = exportDeploymentsToFile(artifacts, opts.out);
      if (exportResult.success) {
        logger.success(`Successfully exported deployment artifacts to ${exportResult.filePath}`);
      } else {
        logger.error(`Export failed: ${exportResult.error}`);
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Export command failed: ${msg}`);
      process.exitCode = 1;
    }
  });

  return cmd;
}
