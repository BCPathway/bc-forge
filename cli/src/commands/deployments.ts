import { Command } from 'commander';
import { addNetworkOptions, resolveNetworkConfig, mergeNetworkOptions } from '../network.js';
import logger from '../utils/logger.js';
import {
  DEFAULT_REGISTRY_PATH,
  registerDeploymentAlias,
  resolveContractReference,
} from '../utils/registry.js';

function selectedNetwork(command: Command): string {
  return resolveNetworkConfig(mergeNetworkOptions(command)).name;
}

/**
 * `deployments register` persists an alias for one network.
 * `deployments resolve` prints the contract id for the selected network.
 */
export function createDeploymentsCommand(): Command {
  const root = new Command('deployments')
    .description('Store contract ids per network and resolve aliases');

  const register = new Command('register')
    .description('Save an alias for a contract id on the selected network')
    .argument('<alias>', 'Short name used in later commands, such as "token"')
    .argument('<id>', 'Deployed contract id (C...)')
    .option('-f, --file <path>', 'Registry JSON path', DEFAULT_REGISTRY_PATH);

  addNetworkOptions(register);

  register.action(async (alias: string, id: string, opts: { file: string }, command: Command) => {
    try {
      const result = registerDeploymentAlias({
        alias,
        contractId: id,
        network: selectedNetwork(command),
        filePath: opts.file,
      });
      logger.success(
        `Registered alias "${result.alias}" on ${result.network} → ${result.contractId}`
      );
      logger.info(`Saved ${result.filePath}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(message);
      process.exitCode = 1;
    }
  });

  const resolve = new Command('resolve')
    .description('Print the contract id for an alias on the selected network')
    .argument('<alias>', 'Alias or contract id')
    .option('-f, --file <path>', 'Registry JSON path', DEFAULT_REGISTRY_PATH);

  addNetworkOptions(resolve);

  resolve.action(async (alias: string, opts: { file: string }, command: Command) => {
    try {
      const contractId = resolveContractReference(alias, {
        network: selectedNetwork(command),
        filePath: opts.file,
      });
      process.stdout.write(`${contractId}\n`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(message);
      process.exitCode = 1;
    }
  });

  root.addCommand(register);
  root.addCommand(resolve);
  return root;
}
