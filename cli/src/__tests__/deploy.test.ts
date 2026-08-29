/**
 * CLI deploy command tests (#746)
 *
 * Tests for deployVault() and the createDeployCommand() factory.
 * All subprocess calls (stellar CLI) are stubbed out.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { deployVault, createDeployCommand, type DeployVaultOptions } from '../commands/deploy.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COMMON_OPTS: DeployVaultOptions = {
  vaultWasm: '/tmp/vault.wasm',
  admin: 'GABC...ADMIN',
  source: 'SDUMMY_SECRET',
  underlyingToken: 'CUNDER...TOKEN',
  name: 'Wrapped USDC',
  symbol: 'wUSDC',
  decimals: 7,
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
  network: 'testnet',
};

/** Builds a minimal fake spawn child that exits with code 0 and echoes stdout. */
function fakeSpawn(stdout: string) {
  return {
    stdout: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stdout));
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(0);
    }),
  };
}

/** Builds a fake spawn child that exits with code 1. */
function failSpawn(stderr = 'command failed') {
  return {
    stdout: { on: vi.fn() },
    stderr: {
      on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
        if (event === 'data') cb(Buffer.from(stderr));
      }),
    },
    on: vi.fn((event: string, cb: (code: number) => void) => {
      if (event === 'close') cb(1);
    }),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CLI deploy command (#746)', () => {
  let spawnMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cp = await import('node:child_process');
    spawnMock = cp.spawn as unknown as ReturnType<typeof vi.fn>;

    // By default: WASM files exist
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  describe('deployVault', () => {
    it('returns success=false when vault WASM is missing', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

      const result = await deployVault(COMMON_OPTS);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Vault WASM not found/);
    });

    it('returns success=false when fee WASM is specified but missing', async () => {
      (existsSync as ReturnType<typeof vi.fn>).mockImplementation(
        (p: string) => p === COMMON_OPTS.vaultWasm
      );

      const result = await deployVault({ ...COMMON_OPTS, feeWasm: '/tmp/fee.wasm' });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Fee contract WASM not found/);
    });

    it('returns success and records steps in dry-run mode without spawning stellar', async () => {
      const result = await deployVault({ ...COMMON_OPTS, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/[Dd]ry.?run/i);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('uploads, deploys and initializes vault when WASM exists', async () => {
      // 3 calls in sequence: upload, deploy, initialize
      spawnMock
        .mockReturnValueOnce(fakeSpawn('abc123wasmhash')) // upload
        .mockReturnValueOnce(fakeSpawn('CVAULTCONTRACT')) // deploy
        .mockReturnValueOnce(fakeSpawn(''));               // initialize

      const result = await deployVault(COMMON_OPTS);

      expect(result.success).toBe(true);
      expect(result.vaultWasmHash).toBe('abc123wasmhash');
      expect(result.vaultContractId).toBe('CVAULTCONTRACT');
      expect(result.steps).toHaveLength(3);
    });

    it('also deploys and links fee contract when --fee-wasm is provided', async () => {
      spawnMock
        .mockReturnValueOnce(fakeSpawn('vaultWasmHash'))   // vault upload
        .mockReturnValueOnce(fakeSpawn('CVAULTID'))        // vault deploy
        .mockReturnValueOnce(fakeSpawn(''))                // vault init
        .mockReturnValueOnce(fakeSpawn('feeWasmHash'))     // fee upload
        .mockReturnValueOnce(fakeSpawn('CFEEID'))          // fee deploy
        .mockReturnValueOnce(fakeSpawn('link_tx_hash'));   // set_fee_contract

      const result = await deployVault({
        ...COMMON_OPTS,
        feeWasm: '/tmp/fee.wasm',
      });

      expect(result.success).toBe(true);
      expect(result.vaultContractId).toBe('CVAULTID');
      expect(result.feeContractId).toBe('CFEEID');
      expect(result.linkTxHash).toBe('link_tx_hash');
    });

    it('returns failure when a stellar CLI subprocess exits with code 1', async () => {
      spawnMock.mockReturnValueOnce(failSpawn('upload error'));

      const result = await deployVault(COMMON_OPTS);

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Deployment failed/);
    });

    it('exports deployment artifacts JSON when out option is specified', async () => {
      spawnMock
        .mockReturnValueOnce(fakeSpawn('hash_vault_wasm'))
        .mockReturnValueOnce(fakeSpawn('CVAULT_EXPORT_TEST'))
        .mockReturnValueOnce(fakeSpawn(''));

      const outPath = '/tmp/test-deployments-out.json';
      const result = await deployVault({
        ...COMMON_OPTS,
        out: outPath,
      });

      expect(result.success).toBe(true);
      expect(result.outPath).toBe(path.resolve(outPath));
    });
  });

  describe('createDeployCommand', () => {
    it('exposes the deploy command with the correct name', () => {
      const cmd = createDeployCommand();
      expect(cmd.name()).toBe('deploy');
    });

    it('has required --vault-wasm, --admin, --source, --underlying-token, --name, --symbol options', () => {
      const cmd = createDeployCommand();
      const optionNames = cmd.options.map((o) => o.long);
      expect(optionNames).toContain('--vault-wasm');
      expect(optionNames).toContain('--admin');
      expect(optionNames).toContain('--source');
      expect(optionNames).toContain('--underlying-token');
      expect(optionNames).toContain('--name');
      expect(optionNames).toContain('--symbol');
    });

    it('has optional --fee-wasm, --out, and --dry-run options', () => {
      const cmd = createDeployCommand();
      const optionNames = cmd.options.map((o) => o.long);
      expect(optionNames).toContain('--fee-wasm');
      expect(optionNames).toContain('--out');
      expect(optionNames).toContain('--dry-run');
    });
  });
});
