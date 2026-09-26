import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Command } from 'commander';
import {
  UnknownAliasError,
  isContractId,
  registerDeploymentAlias,
  resolveContractIdOption,
  resolveContractReference,
} from '../utils/registry.js';
import { createDeploymentsCommand } from '../commands/deployments.js';
import { createUpgradeCommand } from '../commands/upgrade.js';
import logger from '../utils/logger.js';

const TESTNET_ID = `C${'A'.repeat(55)}`;
const MAINNET_ID = `C${'B'.repeat(55)}`;
const SECRET = `S${'A'.repeat(55)}`;

describe('Deployments registry (#937)', () => {
  let tmpDir: string;
  let registryPath: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-test-'));
    registryPath = path.join(tmpDir, 'deployments.json');
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  describe('register and resolve', () => {
    it('persists an alias per network and resolves it back to the contract id', () => {
      const testnet = registerDeploymentAlias({
        alias: 'token',
        contractId: TESTNET_ID,
        network: 'testnet',
        filePath: registryPath,
      });
      registerDeploymentAlias({
        alias: 'token',
        contractId: MAINNET_ID,
        network: 'mainnet',
        filePath: registryPath,
      });

      expect(testnet.network).toBe('testnet');
      expect(testnet.alias).toBe('token');
      expect(resolveContractReference('token', { network: 'testnet', filePath: registryPath })).toBe(TESTNET_ID);
      expect(resolveContractReference('token', { network: 'TestNet', filePath: registryPath })).toBe(TESTNET_ID);
      expect(resolveContractReference('token', { network: 'mainnet', filePath: registryPath })).toBe(MAINNET_ID);
      expect(resolveContractReference('token', { network: 'pubnet', filePath: registryPath })).toBe(MAINNET_ID);

      const stored = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      expect(stored.networks.testnet.token).toBe(TESTNET_ID);
      expect(stored.networks.mainnet.token).toBe(MAINNET_ID);
      expect(JSON.stringify(stored)).not.toContain(SECRET);
    });

    it('returns a raw contract id without reading the registry', () => {
      expect(isContractId(TESTNET_ID)).toBe(true);
      expect(resolveContractReference(TESTNET_ID, { network: 'testnet', filePath: registryPath })).toBe(TESTNET_ID);
      expect(fs.existsSync(registryPath)).toBe(false);
    });

    it('fails an unknown alias with the alias name in the error', () => {
      registerDeploymentAlias({
        alias: 'token',
        contractId: TESTNET_ID,
        network: 'testnet',
        filePath: registryPath,
      });

      expect(() =>
        resolveContractReference('missing-vault', { network: 'testnet', filePath: registryPath }),
      ).toThrow(UnknownAliasError);
      expect(() =>
        resolveContractReference('missing-vault', { network: 'testnet', filePath: registryPath }),
      ).toThrow(/missing-vault/);
      expect(() =>
        resolveContractReference('token', { network: 'mainnet', filePath: registryPath }),
      ).toThrow(/Unknown deployment alias "token"/);
    });

    it('preserves an existing export snapshot when registering', () => {
      fs.writeFileSync(
        registryPath,
        JSON.stringify({
          version: '1.0.0',
          timestamp: '2020-01-01T00:00:00.000Z',
          contracts: { vault: { contractId: 'OLD' } },
        }),
        'utf-8',
      );

      registerDeploymentAlias({
        alias: 'token',
        contractId: TESTNET_ID,
        network: 'testnet',
        filePath: registryPath,
      });

      const stored = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      expect(stored.contracts.vault.contractId).toBe('OLD');
      expect(stored.networks.testnet.token).toBe(TESTNET_ID);
    });

    it('refuses to store a secret key', () => {
      expect(() =>
        registerDeploymentAlias({
          alias: 'token',
          contractId: SECRET,
          network: 'testnet',
          filePath: registryPath,
        }),
      ).toThrow(/secret key/i);
      expect(fs.existsSync(registryPath)).toBe(false);
    });

    it('resolves an alias for the network selected on a contract-id command', () => {
      registerDeploymentAlias({
        alias: 'token',
        contractId: TESTNET_ID,
        network: 'testnet',
        filePath: registryPath,
      });

      const cmd = createUpgradeCommand();
      cmd.setOptionValue('network', 'testnet');
      expect(resolveContractIdOption(cmd, 'token', registryPath)).toBe(TESTNET_ID);

      cmd.setOptionValue('network', 'mainnet');
      expect(() => resolveContractIdOption(cmd, 'token', registryPath)).toThrow(/token/);
    });
  });

  describe('deployments CLI', () => {
    async function run(args: string[]) {
      const errors: string[] = [];
      const spy = vi.spyOn(logger, 'error').mockImplementation((message: string) => {
        errors.push(message);
      });
      let stdout = '';
      const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
      });
      process.exitCode = 0;
      try {
        await createDeploymentsCommand().parseAsync(['node', 'deployments', ...args]);
        return { errors, stdout, exitCode: process.exitCode };
      } finally {
        spy.mockRestore();
        outSpy.mockRestore();
      }
    }

    it('registers and resolves an alias from the command line', async () => {
      process.exitCode = 0;
      const registered = await run([
        'register',
        'token',
        TESTNET_ID,
        '--network',
        'testnet',
        '--file',
        registryPath,
      ]);
      expect(registered.exitCode).not.toBe(1);
      expect(fs.existsSync(registryPath)).toBe(true);

      const resolved = await run([
        'resolve',
        'token',
        '--network',
        'testnet',
        '--file',
        registryPath,
      ]);
      expect(resolved.exitCode).not.toBe(1);
      expect(resolved.stdout).toContain(TESTNET_ID);
    });

    it('fails a CLI resolve of an unknown alias with the alias name', async () => {
      const result = await run([
        'resolve',
        'missing-vault',
        '--network',
        'local',
        '--file',
        registryPath,
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.errors.join('\n')).toContain('missing-vault');
    });
  });

  describe('upgrade --contract-id alias', () => {
    it('fails clearly when the alias is not registered for the selected network', async () => {
      process.chdir(tmpDir);
      const errors: string[] = [];
      const spy = vi.spyOn(logger, 'error').mockImplementation((message: string) => {
        errors.push(message);
      });
      try {
        await createUpgradeCommand().parseAsync([
          'node',
          'upgrade',
          '--wasm',
          'missing.wasm',
          '--contract-id',
          'my-token',
          '--source',
          'S...',
          '--network',
          'testnet',
        ]);
        expect(process.exitCode).toBe(1);
        expect(errors.join('\n')).toContain('my-token');
        expect(errors.join('\n')).not.toContain('WASM file not found');
      } finally {
        spy.mockRestore();
      }
    });
  });
});

describe('resolveContractIdOption ignores blank values', () => {
  it('returns undefined when no contract id was passed', () => {
    const cmd = new Command('demo');
    expect(resolveContractIdOption(cmd, undefined)).toBeUndefined();
    expect(resolveContractIdOption(cmd, '   ')).toBeUndefined();
  });
});
