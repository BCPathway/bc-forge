import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import { Contract, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { getClientConfig, loadConfigFile } from '../utils/config.js';
import logger from '../utils/logger.js';
import type { ContractDeploymentConfig } from '../utils/config-parser.js';
import { addNetworkOptions, explicitNetworkOverrides } from '../network.js';

const execFileAsync = promisify(execFile);

/**
 * Minimum toolchain versions the `doctor` command enforces (#940).
 *
 * These mirror the requirements documented in CONTRIBUTING.md
 * ("Rust 1.74+" and "Stellar CLI 22.0+"); keep the two in sync.
 */
export const MINIMUM_TOOLCHAIN_VERSIONS = {
  rustc: '1.74.0',
  stellar: '22.0.0'
} as const;

/** A deployed contract instance is warned about below this many remaining ledgers. */
export const DEFAULT_TTL_WARNING_LEDGERS = 100_000;

export type DoctorCheckStatus = 'ok' | 'warn' | 'fail';

export interface DoctorCheck {
  name: string;
  status: DoctorCheckStatus;
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  /** False when at least one check failed (warnings do not fail the doctor). */
  allOk: boolean;
}

/** Runs a toolchain version command and returns its stdout (mocked in tests). */
export type VersionRunner = (command: 'rustc' | 'stellar') => Promise<string>;

/** Subset of the Soroban RPC server the doctor needs. */
export interface DoctorRpc {
  getHealth(): Promise<{ status?: string } & Record<string, unknown>>;
  getLedgerEntries: SorobanRpc.Server['getLedgerEntries'];
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

/** Extracts the first `x.y(.z)` version from a toolchain version banner. */
export function parseToolchainVersion(output: string): string | undefined {
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : undefined;
}

export async function defaultVersionRunner(
  command: 'rustc' | 'stellar'
): Promise<string> {
  const { stdout } = await execFileAsync(command, ['--version']);
  return stdout;
}

/** Checks one toolchain binary against its documented minimum. */
export async function checkToolchain(
  command: 'rustc' | 'stellar',
  minimum: string,
  versionRunner: VersionRunner
): Promise<DoctorCheck> {
  try {
    const output = await versionRunner(command);
    const version = parseToolchainVersion(output);
    if (!version) {
      return {
        name: command,
        status: 'fail',
        detail: `Could not parse a version from "${output.trim().split('\n')[0]}"`
      };
    }
    if (compareVersions(version, minimum) < 0) {
      return {
        name: command,
        status: 'fail',
        detail: `${command} ${version} is below the required ${minimum} (see CONTRIBUTING.md)`
      };
    }
    return { name: command, status: 'ok', detail: `${command} ${version} (minimum ${minimum})` };
  } catch (err: any) {
    return {
      name: command,
      status: 'fail',
      detail: `${command} could not be run: ${err.message}`
    };
  }
}

/** Checks that the configured RPC endpoint answers a health probe. */
export async function checkRpcHealth(rpc: DoctorRpc): Promise<DoctorCheck> {
  try {
    const health = await rpc.getHealth();
    const status = typeof health?.status === 'string' ? health.status : 'unknown';
    if (status === 'healthy') {
      return { name: 'rpc', status: 'ok', detail: `RPC is healthy (${status})` };
    }
    return { name: 'rpc', status: 'fail', detail: `RPC health reports "${status}"` };
  } catch (err: any) {
    return { name: 'rpc', status: 'fail', detail: `RPC health check failed: ${err.message}` };
  }
}

/**
 * Reports whether a deployed contract's instance TTL is comfortably above the
 * warning threshold.
 *
 * The instance ledger entry is the TTL source of truth: when the RPC returns
 * the entry with a `liveUntilLedgerSeq` it is compared against the warning
 * threshold; when no such field is available the doctor reports that the TTL
 * getter is absent rather than guessing (#940).
 */
export async function checkContractTtl(
  rpc: DoctorRpc,
  name: string,
  deployment: ContractDeploymentConfig,
  warningLedgers: number
): Promise<DoctorCheck> {
  const contractId = deployment.contractId;
  if (!contractId) {
    return { name: `ttl:${name}`, status: 'warn', detail: 'No contractId configured' };
  }

  let footprint;
  try {
    footprint = new Contract(contractId).getFootprint();
  } catch (err: any) {
    return { name: `ttl:${name}`, status: 'warn', detail: `Invalid contract ID: ${err.message}` };
  }

  try {
    const response = await rpc.getLedgerEntries(footprint);
    const entry = response.entries?.[0] as
      | { liveUntilLedgerSeq?: number | string }
      | undefined;

    if (!entry) {
      return { name: `ttl:${name}`, status: 'warn', detail: 'Contract is not deployed on this network' };
    }

    const liveUntil = Number(entry.liveUntilLedgerSeq);
    if (!Number.isFinite(liveUntil) || liveUntil <= 0) {
      return {
        name: `ttl:${name}`,
        status: 'warn',
        detail: 'TTL getter absent: the instance entry exposes no liveUntilLedgerSeq'
      };
    }

    if (liveUntil < warningLedgers) {
      return {
        name: `ttl:${name}`,
        status: 'warn',
        detail: `Instance TTL ends at ledger ${liveUntil}, below the warning threshold of ${warningLedgers}`
      };
    }
    return {
      name: `ttl:${name}`,
      status: 'ok',
      detail: `Instance TTL ends at ledger ${liveUntil} (threshold ${warningLedgers})`
    };
  } catch (err: any) {
    return { name: `ttl:${name}`, status: 'warn', detail: `TTL check failed: ${err.message}` };
  }
}

export interface DoctorDeps {
  versionRunner?: VersionRunner;
  rpc?: DoctorRpc;
  contracts?: Array<{ name: string; deployment: ContractDeploymentConfig }>;
  ttlWarningLedgers?: number;
}

/**
 * Runs every doctor check and aggregates the report (#940).
 *
 * Toolchain and RPC checks always run; TTL checks run per configured contract
 * when an RPC endpoint is available.
 */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorResult> {
  const versionRunner = deps.versionRunner ?? defaultVersionRunner;
  const warningLedgers = deps.ttlWarningLedgers ?? DEFAULT_TTL_WARNING_LEDGERS;

  const checks: DoctorCheck[] = [];
  checks.push(await checkToolchain('rustc', MINIMUM_TOOLCHAIN_VERSIONS.rustc, versionRunner));
  checks.push(await checkToolchain('stellar', MINIMUM_TOOLCHAIN_VERSIONS.stellar, versionRunner));

  const rpc = deps.rpc;
  if (rpc) {
    checks.push(await checkRpcHealth(rpc));
    for (const { name, deployment } of deps.contracts ?? []) {
      checks.push(await checkContractTtl(rpc, name, deployment, warningLedgers));
    }
  }

  return { checks, allOk: checks.every((c) => c.status !== 'fail') };
}

/**
 * Builds the `doctor` command (#940): reports toolchain, RPC, and contract
 * instance TTL status without needing a live contract invocation.
 */
export function createDoctorCommand(): Command {
  const cmd = new Command('doctor')
    .description(
      'Check toolchain versions, RPC health, and deployed contract instance TTLs'
    )
    .option('-c, --config <file>', 'Path to a .bc-forge.json deployment configuration file')
    .option(
      '--ttl-warning-ledgers <n>',
      'Warn when a contract instance TTL ends before this many ledgers',
      String(DEFAULT_TTL_WARNING_LEDGERS)
    );

  addNetworkOptions(cmd);

  cmd.action(async (options, command) => {
    try {
      let contracts: Array<{ name: string; deployment: ContractDeploymentConfig }> = [];
      if (options.config) {
        const parsed = loadConfigFile(options.config);
        if (!parsed.success || !parsed.config) {
          parsed.errors?.forEach(err => logger.error(`  - ${err}`));
          throw new Error('Failed to load deployment configuration');
        }
        contracts = Object.entries(parsed.config.contracts ?? {}).map(
          ([name, deployment]) => ({ name, deployment: deployment ?? {} })
        );
      }

      const clientConfig = getClientConfig(explicitNetworkOverrides(command));
      const server = new SorobanRpc.Server(clientConfig.rpcUrl, {
        allowHttp: clientConfig.rpcUrl.startsWith('http://')
      });

      const result = await runDoctor({
        rpc: server as unknown as DoctorRpc,
        contracts,
        ttlWarningLedgers: Number(options.ttlWarningLedgers) || DEFAULT_TTL_WARNING_LEDGERS
      });

      for (const check of result.checks) {
        const label = check.name.startsWith('ttl:') ? check.name : check.name;
        if (check.status === 'ok') {
          logger.success(`${label}: ${check.detail}`);
        } else if (check.status === 'warn') {
          logger.warn(`${label}: ${check.detail}`);
        } else {
          logger.error(`${label}: ${check.detail}`);
        }
      }

      if (!result.allOk) {
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

  return cmd;
}
