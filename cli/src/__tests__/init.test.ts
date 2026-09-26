import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createInitCommand, runInit } from '../commands/init.js';
import { MOCK_PUBLIC_KEY } from './mocks.js';
import logger from '../utils/logger.js';

const FLAGS = [
  '--network',
  'testnet',
  '--rpc-url',
  'https://soroban-testnet.stellar.org',
  '--admin',
  MOCK_PUBLIC_KEY,
  '--name',
  'bc-forge Token',
  '--symbol',
  'BFG',
  '--decimals',
  '7',
  '--initial-supply',
  '1000000',
];

describe('bc-forge init (#936)', () => {
  let tmpDir: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-test-'));
    process.chdir(tmpDir);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  async function runCommand(args: string[]) {
    const errors: string[] = [];
    const spy = vi.spyOn(logger, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });
    process.exitCode = 0;
    try {
      await createInitCommand().parseAsync(['node', 'init', ...args]);
      return { errors, exitCode: process.exitCode };
    } finally {
      spy.mockRestore();
    }
  }

  function readConfig() {
    return JSON.parse(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8'));
  }

  it('writes config.json from non-interactive flags', async () => {
    const result = await runCommand(FLAGS);
    expect(result.exitCode).not.toBe(1);
    expect(result.errors).toEqual([]);

    expect(readConfig()).toEqual({
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      admin: MOCK_PUBLIC_KEY,
      name: 'bc-forge Token',
      symbol: 'BFG',
      decimals: 7,
      initialSupply: '1000000',
    });
    expect(readConfig().secretKey).toBeUndefined();
  });

  it('applies the testnet, RPC, and decimals defaults when those flags are omitted', async () => {
    const result = await runInit({
      cwd: tmpDir,
      interactive: false,
      flags: {
        admin: MOCK_PUBLIC_KEY,
        name: 'Default Token',
        symbol: 'DFT',
        initialSupply: '0',
      },
    });

    expect(result.config).toMatchObject({
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      decimals: 7,
      initialSupply: '0',
    });
  });

  it('refuses to overwrite config.json unless --force is passed', async () => {
    await runCommand(FLAGS);
    const original = fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8');

    const blocked = await runCommand(FLAGS.map((arg) => (arg === 'bc-forge Token' ? 'Replaced' : arg)));
    expect(blocked.exitCode).toBe(1);
    expect(blocked.errors.join('\n')).toContain('--force');
    expect(fs.readFileSync(path.join(tmpDir, 'config.json'), 'utf-8')).toBe(original);

    const replaced = await runCommand([
      ...FLAGS.map((arg) => (arg === 'bc-forge Token' ? 'Replaced' : arg)),
      '--force',
    ]);
    expect(replaced.exitCode).not.toBe(1);
    expect(readConfig().name).toBe('Replaced');
    expect(readConfig().symbol).toBe('BFG');
  });

  it('requires the remaining flags when stdin is not a terminal', async () => {
    await expect(
      runInit({
        cwd: tmpDir,
        interactive: false,
        flags: { network: 'testnet' },
      }),
    ).rejects.toThrow(/--admin/);

    expect(fs.existsSync(path.join(tmpDir, 'config.json'))).toBe(false);
  });

  it('prompts for missing answers and keeps values supplied by flags', async () => {
    const prompts: string[] = [];
    const result = await runInit({
      cwd: tmpDir,
      interactive: true,
      flags: {
        admin: MOCK_PUBLIC_KEY,
        name: 'Prompted Token',
        symbol: 'PRT',
        initialSupply: '42',
      },
      prompt: async (label, defaultValue) => {
        prompts.push(label);
        return defaultValue ?? '';
      },
    });

    expect(prompts).toEqual(['Network', 'RPC URL', 'Decimals']);
    expect(result.config).toMatchObject({
      network: 'testnet',
      rpcUrl: 'https://soroban-testnet.stellar.org',
      name: 'Prompted Token',
      symbol: 'PRT',
      decimals: 7,
      initialSupply: '42',
    });
  });
});
