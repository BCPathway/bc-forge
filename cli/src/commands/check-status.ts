import { Command } from 'commander';
import { Contract, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { getClientConfig, loadConfigFile } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { BcForgeConfig, ContractDeploymentConfig } from '../utils/config-parser.js';

export type ContractStatus = 'responsive' | 'unreachable' | 'not_deployed' | 'invalid';

export interface ContractStatusReport {
  name: string;
  contractId?: string;
  status: ContractStatus;
  latencyMs?: number;
  error?: string;
}

export interface CheckStatusResult {
  network?: string;
  rpcUrl: string;
  reports: ContractStatusReport[];
  allResponsive: boolean;
}

export interface StatusChecker {
  getLedgerEntries: SorobanRpc.Server['getLedgerEntries'];
}

/**
 * Collects the deployed contracts declared under `contracts` in .bc-forge.json.
 */
export function collectContracts(
  config: BcForgeConfig
): Array<{ name: string; deployment: ContractDeploymentConfig }> {
  const contracts = config.contracts;
  if (!contracts) return [];

  return Object.entries(contracts).map(([name, deployment]) => ({
    name,
    deployment: deployment ?? {}
  }));
}

/**
 * Pings a single contract by reading its instance ledger entry. A contract that
 * returns an instance entry is deployed and served by the RPC node; a missing
 * entry means the ID is not deployed on this network.
 */
export async function pingContract(
  server: StatusChecker,
  name: string,
  deployment: ContractDeploymentConfig,
  now: () => number = () => Date.now()
): Promise<ContractStatusReport> {
  const contractId = deployment.contractId;

  if (!contractId) {
    return {
      name,
      status: 'invalid',
      error: 'No contractId configured'
    };
  }

  let footprint;
  try {
    footprint = new Contract(contractId).getFootprint();
  } catch (err: any) {
    return {
      name,
      contractId,
      status: 'invalid',
      error: err.message
    };
  }

  const startedAt = now();
  try {
    const response = await server.getLedgerEntries(footprint);
    const latencyMs = now() - startedAt;

    if (!response.entries || response.entries.length === 0) {
      return {
        name,
        contractId,
        status: 'not_deployed',
        latencyMs,
        error: 'No contract instance found on this network'
      };
    }

    return { name, contractId, status: 'responsive', latencyMs };
  } catch (err: any) {
    return {
      name,
      contractId,
      status: 'unreachable',
      latencyMs: now() - startedAt,
      error: err.message
    };
  }
}

/**
 * Pings every configured contract and reports latency and reachability.
 */
export async function checkStatus(
  server: StatusChecker,
  config: BcForgeConfig,
  rpcUrl: string,
  now: () => number = () => Date.now()
): Promise<CheckStatusResult> {
  const contracts = collectContracts(config);

  const reports = await Promise.all(
    contracts.map(({ name, deployment }) => pingContract(server, name, deployment, now))
  );

  return {
    network: config.network,
    rpcUrl,
    reports,
    allResponsive: reports.length > 0 && reports.every(r => r.status === 'responsive')
  };
}

/**
 * Builds the `check-status` command.
 */
export function createCheckStatusCommand(): Command {
  return new Command('check-status')
    .description('Ping all deployed contracts and report latency and status')
    .option('-c, --config <file>', 'Path to a .bc-forge.json deployment configuration file')
    .action(async (options) => {
      try {
        const parsed = loadConfigFile(options.config);
        if (!parsed.success || !parsed.config) {
          parsed.errors?.forEach(err => logger.error(`  - ${err}`));
          throw new Error('Failed to load deployment configuration');
        }

        const clientConfig = getClientConfig();
        logger.debug(`Pinging contracts via RPC: ${clientConfig.rpcUrl}`);

        const server = new SorobanRpc.Server(clientConfig.rpcUrl);
        const status = await checkStatus(server, parsed.config, clientConfig.rpcUrl);

        if (status.reports.length === 0) {
          logger.warn('No contracts declared under "contracts" in the configuration file.');
          return;
        }

        logger.info(`Network: ${status.network ?? 'unknown'} (${status.rpcUrl})`);
        for (const report of status.reports) {
          const latency = report.latencyMs !== undefined ? ` ${report.latencyMs}ms` : '';
          const target = report.contractId ?? 'no contract id';
          if (report.status === 'responsive') {
            logger.success(`${report.name}: responsive${latency} [${target}]`);
          } else {
            logger.error(`${report.name}: ${report.status}${latency} [${target}] - ${report.error}`);
          }
        }

        if (!status.allResponsive) {
          process.exitCode = 1;
        }
      } catch (err: any) {
        logger.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}
