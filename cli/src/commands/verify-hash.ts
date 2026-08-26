import fs from 'node:fs';
import crypto from 'node:crypto';
import { Command } from 'commander';
import { Contract, xdr, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { getClientConfig } from '../utils/config.js';
import logger from '../utils/logger.js';

export type HashVerdict = 'match' | 'mismatch' | 'missing_local' | 'missing_onchain' | 'invalid';

export interface HashComparison {
  name: string;
  contractId?: string;
  wasmPath?: string;
  localHash?: string;
  onChainHash?: string;
  verdict: HashVerdict;
  error?: string;
}

export interface HashFetcher {
  getLedgerEntries: SorobanRpc.Server['getLedgerEntries'];
}

/**
 * Computes the Soroban WASM hash of a local build artifact.
 *
 * Soroban identifies uploaded contract code by the SHA-256 of the raw .wasm
 * bytes, so hashing the file reproduces exactly the hash stored on-chain.
 */
export function hashLocalWasm(wasmPath: string): string {
  const bytes = fs.readFileSync(wasmPath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Extracts the WASM hash referenced by a contract instance ledger entry.
 *
 * Returns undefined for Stellar-asset contracts, which have no uploaded WASM.
 */
export function extractOnChainHash(entryData: xdr.LedgerEntryData): string | undefined {
  if (entryData.switch().name !== 'contractData') return undefined;

  const val = entryData.contractData().val();
  if (val.switch().name !== 'scvContractInstance') return undefined;

  const executable = val.instance().executable();
  if (executable.switch().name !== 'contractExecutableWasm') return undefined;

  return executable.wasmHash().toString('hex');
}

/**
 * Fetches the WASM hash a deployed contract currently runs.
 */
export async function fetchOnChainHash(
  server: HashFetcher,
  contractId: string
): Promise<string | undefined> {
  const footprint = new Contract(contractId).getFootprint();
  const response = await server.getLedgerEntries(footprint);

  const entry = response.entries?.[0];
  if (!entry) return undefined;

  return extractOnChainHash(entry.val);
}

/**
 * Diffs a local build artifact against the WASM hash a deployed contract runs.
 */
export async function verifyHash(
  server: HashFetcher,
  name: string,
  contractId: string | undefined,
  wasmPath: string | undefined
): Promise<HashComparison> {
  if (!contractId) {
    return { name, wasmPath, verdict: 'invalid', error: 'No contractId configured' };
  }
  if (!wasmPath) {
    return { name, contractId, verdict: 'invalid', error: 'No local WASM path provided' };
  }

  let localHash: string;
  try {
    localHash = hashLocalWasm(wasmPath);
  } catch (err: any) {
    return {
      name,
      contractId,
      wasmPath,
      verdict: 'missing_local',
      error: `Could not read local WASM: ${err.message}`
    };
  }

  let onChainHash: string | undefined;
  try {
    onChainHash = await fetchOnChainHash(server, contractId);
  } catch (err: any) {
    return {
      name,
      contractId,
      wasmPath,
      localHash,
      verdict: 'invalid',
      error: err.message
    };
  }

  if (!onChainHash) {
    return {
      name,
      contractId,
      wasmPath,
      localHash,
      verdict: 'missing_onchain',
      error: 'No WASM hash found on-chain for this contract'
    };
  }

  return {
    name,
    contractId,
    wasmPath,
    localHash,
    onChainHash,
    verdict: localHash === onChainHash ? 'match' : 'mismatch'
  };
}

/**
 * Builds the `verify-hash` command.
 */
export function createVerifyHashCommand(): Command {
  return new Command('verify-hash')
    .description('Diff a local WASM build against the hash a deployed contract runs')
    .requiredOption('--wasm <path>', 'Path to the locally built .wasm artifact')
    .option('--contract-id <id>', 'Contract to verify against (defaults to the configured contract)')
    .option('--name <name>', 'Label for the contract in the report', 'contract')
    .action(async (options) => {
      try {
        const clientConfig = getClientConfig();
        const contractId = options.contractId || clientConfig.contractId;

        logger.debug(`Verifying ${options.wasm} against ${contractId}`);

        const server = new SorobanRpc.Server(clientConfig.rpcUrl);
        const result = await verifyHash(server, options.name, contractId, options.wasm);

        if (result.localHash) logger.info(`Local hash:    ${result.localHash}`);
        if (result.onChainHash) logger.info(`On-chain hash: ${result.onChainHash}`);

        if (result.verdict === 'match') {
          logger.success(`${result.name}: local build matches the deployed contract`);
        } else {
          logger.error(`${result.name}: ${result.verdict}${result.error ? ` - ${result.error}` : ''}`);
          process.exitCode = 1;
        }
      } catch (err: any) {
        logger.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}
