import { Command } from 'commander';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { addNetworkOptions, explicitNetworkOverrides } from '../network.js';
import { getClientConfig } from '../utils/config.js';
import { buildDeploymentArtifacts, exportDeploymentsToFile } from '../utils/deployments.js';
import logger from '../utils/logger.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DeployVaultOptions {
  /** Path to the vault (WrapperContract) WASM binary. */
  vaultWasm: string;
  /** Path to the fee contract WASM binary. */
  feeWasm?: string;
  /** Admin address for both contracts. */
  admin: string;
  /** Source account secret key (for transaction signing). */
  source: string;
  /** Underlying SEP-41 token contract ID to wrap. */
  underlyingToken: string;
  /** Human-readable name for the wrapped token (e.g. "Wrapped USDC"). */
  name: string;
  /** Ticker symbol for the wrapped token (e.g. "wUSDC"). */
  symbol: string;
  /** Decimal places for the wrapped token. Defaults to 7 (XLM precision). */
  decimals?: number;
  /** Soroban RPC URL resolved from --network or --rpc-url flags. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Network name (for logging). */
  network?: string;
  /** If true, print commands but do not execute them. */
  dryRun?: boolean;
  /** Target path to export deployed contract IDs and transaction hashes (e.g. "deployments.json"). */
  out?: string;
}

export interface DeployVaultResult {
  success: boolean;
  vaultContractId?: string;
  feeContractId?: string;
  vaultWasmHash?: string;
  feeWasmHash?: string;
  linkTxHash?: string;
  outPath?: string;
  message: string;
  steps: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Runs `stellar contract ...` subcommand and returns stdout, or throws on failure.
 */
async function runStellar(args: string[], dryRun = false): Promise<string> {
  const bin = process.env.STELLAR_CLI_BIN ?? process.env.SOROBAN_CLI_BIN ?? 'stellar';
  const fullArgs = ['contract', ...args];

  if (dryRun) {
    logger.info(`[dry-run] ${bin} ${fullArgs.join(' ')}`);
    return '';
  }

  logger.debug(`Running: ${bin} ${fullArgs.join(' ')}`);

  return new Promise((resolve, reject) => {
    const child = spawn(bin, fullArgs, { shell: false });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(
            `stellar contract ${args[0]} failed (exit ${code})${stderr ? ': ' + stderr.trim() : ''}`,
          ),
        );
      }
    });
  });
}

/**
 * Upload a WASM binary and return its on-chain hash.
 */
async function uploadWasm(
  wasmPath: string,
  rpcUrl: string,
  networkPassphrase: string,
  source: string,
  dryRun = false,
): Promise<string | undefined> {
  const hash = await runStellar(
    [
      'upload',
      '--wasm', wasmPath,
      '--rpc-url', rpcUrl,
      '--network-passphrase', networkPassphrase,
      '--source-account', source,
    ],
    dryRun,
  );
  return hash || undefined;
}

/**
 * Deploy a contract from its on-chain WASM hash and return the contract ID.
 */
async function deployFromHash(
  wasmHash: string,
  rpcUrl: string,
  networkPassphrase: string,
  source: string,
  dryRun = false,
): Promise<string | undefined> {
  const contractId = await runStellar(
    [
      'deploy',
      '--wasm-hash', wasmHash,
      '--rpc-url', rpcUrl,
      '--network-passphrase', networkPassphrase,
      '--source-account', source,
    ],
    dryRun,
  );
  return contractId || undefined;
}

/**
 * Invoke a contract function with named arguments.
 */
async function invokeContract(
  contractId: string,
  fn: string,
  fnArgs: string[],
  rpcUrl: string,
  networkPassphrase: string,
  source: string,
  dryRun = false,
): Promise<string> {
  return runStellar(
    [
      'invoke',
      '--id', contractId,
      '--fn', fn,
      '--rpc-url', rpcUrl,
      '--network-passphrase', networkPassphrase,
      '--source-account', source,
      '--',
      ...fnArgs,
    ],
    dryRun,
  );
}

// ─── Core deploy logic ───────────────────────────────────────────────────────

/**
 * Deploys the vault (WrapperContract) and optionally links a fee contract.
 *
 * Deployment sequence:
 *  1. Upload vault WASM → get vault WASM hash
 *  2. Deploy vault from hash → get vault contract ID
 *  3. Initialize the vault (admin, underlyingToken, decimals, name, symbol)
 *  4. (Optional) Upload fee WASM → deploy fee contract → call `set_fee_contract`
 *     on the vault to link the fee contract
 */
export async function deployVault(opts: DeployVaultOptions): Promise<DeployVaultResult> {
  const steps: string[] = [];

  try {
    // Validate WASM paths
    if (!existsSync(opts.vaultWasm)) {
      return {
        success: false,
        message: `Vault WASM not found: ${opts.vaultWasm}`,
        steps,
      };
    }
    if (opts.feeWasm && !existsSync(opts.feeWasm)) {
      return {
        success: false,
        message: `Fee contract WASM not found: ${opts.feeWasm}`,
        steps,
      };
    }

    const { rpcUrl, networkPassphrase, source, dryRun = false } = opts;

    // ── Step 1: Upload vault WASM ─────────────────────────────────────────
    steps.push('Uploading vault WASM…');
    logger.info(steps[steps.length - 1]);

    const vaultWasmHash = await uploadWasm(
      opts.vaultWasm, rpcUrl, networkPassphrase, source, dryRun,
    );
    if (vaultWasmHash) {
      logger.success(`Vault WASM hash: ${vaultWasmHash}`);
    }

    // ── Step 2: Deploy vault contract ────────────────────────────────────
    steps.push('Deploying vault contract…');
    logger.info(steps[steps.length - 1]);

    const vaultContractId = vaultWasmHash
      ? await deployFromHash(vaultWasmHash, rpcUrl, networkPassphrase, source, dryRun)
      : undefined;
    if (vaultContractId) {
      logger.success(`Vault contract deployed: ${vaultContractId}`);
    }

    // ── Step 3: Initialize vault ─────────────────────────────────────────
    if (vaultContractId) {
      steps.push('Initializing vault…');
      logger.info(steps[steps.length - 1]);

      await invokeContract(
        vaultContractId,
        'initialize',
        [
          '--admin', opts.admin,
          '--token-contract-id', opts.underlyingToken,
          '--decimal', String(opts.decimals ?? 7),
          '--name', opts.name,
          '--symbol', opts.symbol,
        ],
        rpcUrl,
        networkPassphrase,
        source,
        dryRun,
      );
      logger.success('Vault initialized.');
    }

    // ── Step 4 (optional): Upload & deploy fee contract, then link it ────
    let feeContractId: string | undefined;
    let feeWasmHash: string | undefined;
    let linkTxHash: string | undefined;

    if (opts.feeWasm) {
      steps.push('Uploading fee contract WASM…');
      logger.info(steps[steps.length - 1]);

      feeWasmHash = await uploadWasm(
        opts.feeWasm, rpcUrl, networkPassphrase, source, dryRun,
      );
      if (feeWasmHash) {
        logger.success(`Fee WASM hash: ${feeWasmHash}`);
      }

      steps.push('Deploying fee contract…');
      logger.info(steps[steps.length - 1]);

      feeContractId = feeWasmHash
        ? await deployFromHash(feeWasmHash, rpcUrl, networkPassphrase, source, dryRun)
        : undefined;
      if (feeContractId) {
        logger.success(`Fee contract deployed: ${feeContractId}`);
      }

      // Link fee contract to vault via set_fee_contract
      if (vaultContractId && feeContractId) {
        steps.push('Linking fee contract to vault…');
        logger.info(steps[steps.length - 1]);

        linkTxHash = await invokeContract(
          vaultContractId,
          'set_fee_contract',
          ['--fee-contract', feeContractId],
          rpcUrl,
          networkPassphrase,
          source,
          dryRun,
        );
        logger.success(`Fee contract linked. TX: ${linkTxHash}`);
      }
    }

    let outPath: string | undefined;
    if (opts.out) {
      const artifacts = buildDeploymentArtifacts({
        network: opts.network,
        rpcUrl: opts.rpcUrl,
        vaultContractId,
        vaultWasmHash,
        feeContractId,
        feeWasmHash,
        linkTxHash,
      });
      const exportRes = exportDeploymentsToFile(artifacts, opts.out);
      if (exportRes.success) {
        outPath = exportRes.filePath;
      }
    }

    const message = dryRun
      ? 'Dry-run completed — no contracts were actually deployed.'
      : `Vault deployment complete. Contract ID: ${vaultContractId ?? '(dry-run)'}`;

    return {
      success: true,
      vaultContractId,
      feeContractId,
      vaultWasmHash,
      feeWasmHash,
      linkTxHash,
      outPath,
      message,
      steps,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Deployment failed: ${message}`, steps };
  }
}

// ─── Commander command factory ────────────────────────────────────────────────

/**
 * Builds the `deploy` command that deploys the vault and links a fee contract.
 */
export function createDeployCommand(): Command {
  const cmd = new Command('deploy')
    .description('Deploy the yield-bearing vault contract and (optionally) link a fee contract')
    .requiredOption('--vault-wasm <path>', 'Path to the vault (WrapperContract) WASM binary')
    .option('--fee-wasm <path>', 'Path to the fee contract WASM binary (optional)')
    .requiredOption('--admin <address>', 'Admin address for the deployed vault')
    .requiredOption('--source <secret>', 'Source account secret key for signing transactions')
    .requiredOption('--underlying-token <id>', 'Underlying SEP-41 token contract ID to wrap')
    .requiredOption('--name <name>', 'Human-readable name for the wrapped token')
    .requiredOption('--symbol <symbol>', 'Ticker symbol for the wrapped token')
    .option('--decimals <n>', 'Decimal places (default: 7)', '7')
    .option('-o, --out <path>', 'Output file path to export deployment artifact JSON (e.g. deployments.json)')
    .option('--dry-run', 'Print commands but do not execute them', false);

  addNetworkOptions(cmd);

  cmd.action(async (opts, command) => {
    try {
      const netCfg = getClientConfig(explicitNetworkOverrides(command));

      const result = await deployVault({
        vaultWasm: opts.vaultWasm,
        feeWasm: opts.feeWasm,
        admin: opts.admin,
        source: opts.source,
        underlyingToken: opts.underlyingToken,
        name: opts.name,
        symbol: opts.symbol,
        decimals: parseInt(opts.decimals, 10),
        rpcUrl: netCfg.rpcUrl,
        networkPassphrase: netCfg.networkPassphrase,
        network: netCfg.network,
        dryRun: opts.dryRun,
        out: opts.out,
      });

      if (result.success) {
        logger.success(result.message);
        if (result.vaultContractId) {
          logger.info(`  Vault contract ID : ${result.vaultContractId}`);
        }
        if (result.feeContractId) {
          logger.info(`  Fee contract ID   : ${result.feeContractId}`);
        }
        if (result.outPath) {
          logger.info(`  Artifact exported : ${result.outPath}`);
        }
      } else {
        logger.error(result.message);
        process.exitCode = 1;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`Error: ${msg}`);
      process.exitCode = 1;
    }
  });

  return cmd;
}
