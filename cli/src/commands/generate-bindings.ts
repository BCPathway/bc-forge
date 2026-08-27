import { spawn } from 'node:child_process';
import { Command } from 'commander';
import { getClientConfig } from '../utils/config.js';
import logger from '../utils/logger.js';
import { addNetworkOptions, explicitNetworkOverrides } from '../network.js';

export type BindingsLanguage =
  | 'typescript'
  | 'rust'
  | 'python'
  | 'java'
  | 'flutter'
  | 'swift'
  | 'php';

export const SUPPORTED_LANGUAGES: BindingsLanguage[] = [
  'typescript',
  'rust',
  'python',
  'java',
  'flutter',
  'swift',
  'php'
];

/**
 * `stellar contract bindings rust` reads a local wasm only and writes to
 * stdout, so it accepts neither an output directory nor a network source.
 */
const WASM_ONLY_LANGUAGES: BindingsLanguage[] = ['rust'];

export interface GenerateBindingsOptions {
  language: string;
  wasm?: string;
  wasmHash?: string;
  contractId?: string;
  outputDir?: string;
  overwrite?: boolean;
  rpcUrl?: string;
  networkPassphrase?: string;
  network?: string;
}

export interface BindingsResult {
  success: boolean;
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

export interface CommandRunner {
  (command: string, args: string[]): Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>;
}

export class BindingsOptionError extends Error {}

/**
 * Resolves the soroban CLI binary. The tool was renamed `soroban` -> `stellar`,
 * so the binary is overridable for environments still on the older name.
 */
export function resolveBinary(): string {
  return process.env.STELLAR_CLI_BIN || process.env.SOROBAN_CLI_BIN || 'stellar';
}

/**
 * Builds the argument vector for `stellar contract bindings <language>`.
 *
 * Validates the option combination up front so a misuse is reported by this
 * CLI directly instead of surfacing as an opaque subprocess failure.
 */
export function buildBindingsArgs(options: GenerateBindingsOptions): string[] {
  const language = options.language as BindingsLanguage;

  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new BindingsOptionError(
      `Unsupported bindings language: ${options.language}. Supported: ${SUPPORTED_LANGUAGES.join(', ')}`
    );
  }

  const sources = [options.wasm, options.wasmHash, options.contractId].filter(Boolean);
  if (sources.length === 0) {
    throw new BindingsOptionError(
      'A contract source is required: provide exactly one of --wasm, --wasm-hash or --contract-id'
    );
  }
  if (sources.length > 1) {
    throw new BindingsOptionError(
      'Provide exactly one contract source: --wasm, --wasm-hash and --contract-id are mutually exclusive'
    );
  }

  const args = ['contract', 'bindings', language];

  if (WASM_ONLY_LANGUAGES.includes(language)) {
    if (!options.wasm) {
      throw new BindingsOptionError(
        `The ${language} generator reads a local build only: use --wasm`
      );
    }
    args.push('--wasm', options.wasm);
    return args;
  }

  if (!options.outputDir) {
    throw new BindingsOptionError(`--output-dir is required for ${language} bindings`);
  }

  if (options.wasm) args.push('--wasm', options.wasm);
  if (options.wasmHash) args.push('--wasm-hash', options.wasmHash);
  if (options.contractId) args.push('--contract-id', options.contractId);

  args.push('--output-dir', options.outputDir);
  if (options.overwrite) args.push('--overwrite');

  // Only a network-sourced generation needs to reach an RPC node.
  if (!options.wasm) {
    if (options.network) args.push('--network', options.network);
    if (options.rpcUrl) args.push('--rpc-url', options.rpcUrl);
    if (options.networkPassphrase) {
      args.push('--network-passphrase', options.networkPassphrase);
    }
  }

  return args;
}

/** Default runner: spawns the soroban CLI and collects its output. */
export const spawnRunner: CommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
  });

/**
 * Runs `stellar contract bindings <language>` and reports the outcome.
 */
export async function generateBindings(
  options: GenerateBindingsOptions,
  runner: CommandRunner = spawnRunner,
  binary: string = resolveBinary()
): Promise<BindingsResult> {
  let args: string[];
  try {
    args = buildBindingsArgs(options);
  } catch (err: any) {
    return {
      success: false,
      command: binary,
      args: [],
      exitCode: null,
      stdout: '',
      stderr: '',
      error: err.message
    };
  }

  try {
    const { exitCode, stdout, stderr } = await runner(binary, args);
    return {
      success: exitCode === 0,
      command: binary,
      args,
      exitCode,
      stdout,
      stderr,
      error:
        exitCode === 0
          ? undefined
          : `${binary} exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ''}`
    };
  } catch (err: any) {
    const notFound = err?.code === 'ENOENT';
    return {
      success: false,
      command: binary,
      args,
      exitCode: null,
      stdout: '',
      stderr: '',
      error: notFound
        ? `Could not run "${binary}". Install the Stellar CLI (https://developers.stellar.org/docs/tools/cli) or set STELLAR_CLI_BIN to its path.`
        : err.message
    };
  }
}

/**
 * Builds the `generate-bindings` command.
 */
export function createGenerateBindingsCommand(): Command {
  const cmd = new Command('generate-bindings')
    .description('Generate contract client bindings via the Stellar CLI code generator')
    .option('-l, --language <lang>', `Target language (${SUPPORTED_LANGUAGES.join(', ')})`, 'typescript')
    .option('--wasm <path>', 'Local .wasm artifact to generate from')
    .option('--wasm-hash <hash>', 'Hash of a WASM blob already uploaded to the network')
    .option('--contract-id <id>', 'Deployed contract to generate from')
    .option('-o, --output-dir <dir>', 'Directory to write the generated package into')
    .option('--overwrite', 'Overwrite the output directory if it already exists');

  addNetworkOptions(cmd);

  cmd.action(async (options, command) => {
      try {
        const clientConfig = getClientConfig(explicitNetworkOverrides(command));
        const contractId = options.contractId
          || (!options.wasm && !options.wasmHash ? clientConfig.contractId : undefined);

        logger.debug(`Generating ${options.language} bindings`);

        const result = await generateBindings({
          language: options.language,
          wasm: options.wasm,
          wasmHash: options.wasmHash,
          contractId,
          outputDir: options.outputDir,
          overwrite: options.overwrite,
          rpcUrl: clientConfig.rpcUrl,
          networkPassphrase: clientConfig.networkPassphrase,
          network: clientConfig.network
        });

        logger.debug(`Running: ${result.command} ${result.args.join(' ')}`);
        if (result.stdout.trim()) logger.info(result.stdout.trim());

        if (result.success) {
          logger.success(
            options.outputDir
              ? `Generated ${options.language} bindings in ${options.outputDir}`
              : `Generated ${options.language} bindings`
          );
        } else {
          logger.error(result.error ?? 'Bindings generation failed');
          process.exitCode = 1;
        }
      } catch (err: any) {
        logger.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });

  return cmd;
}
