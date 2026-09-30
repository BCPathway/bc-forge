// SPDX-License-Identifier: MIT
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createAccountCommand } from '../commands/account.js';
import { createBatchMintCommand } from '../commands/batch-mint.js';
import { runInit } from '../commands/init.js';
import { saveConfigFile } from '../utils/config-parser.js';
import {
  readStoredAccounts,
  resolveAccount,
  saveAccount,
} from '../utils/address-book.js';
import logger from '../utils/logger.js';

const VALID_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const OTHER_KEY = 'GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U';
const BAD_KEY = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

describe('named address book (#939)', () => {
  let tmpDir: string;
  let configFile: string;
  let previousConfig: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'address-book-'));
    configFile = path.join(tmpDir, 'cli-config.json');
    previousConfig = process.env.BC_FORGE_CLI_CONFIG;
    process.env.BC_FORGE_CLI_CONFIG = configFile;
    process.exitCode = 0;
  });

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.BC_FORGE_CLI_CONFIG;
    else process.env.BC_FORGE_CLI_CONFIG = previousConfig;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('saves a valid address and resolves the name', () => {
    const saved = saveAccount('treasury', VALID_KEY, configFile);

    expect(saved.treasury).toBe(VALID_KEY);
    expect(readStoredAccounts(configFile)).toEqual({ treasury: VALID_KEY });
    expect(resolveAccount('treasury', readStoredAccounts(configFile))).toBe(VALID_KEY);
    expect(resolveAccount(VALID_KEY, readStoredAccounts(configFile))).toBe(VALID_KEY);
  });

  it('rejects a bad checksum and does not write the account', () => {
    expect(() => saveAccount('treasury', BAD_KEY, configFile)).toThrow(/checksum/i);
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it('fails the account add command when the checksum is wrong', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(logger, 'error').mockImplementation((message: string) => {
      errors.push(message);
    });
    try {
      const command = createAccountCommand();
      command.exitOverride();
      await command.parseAsync([
        'node',
        'account',
        'add',
        'treasury',
        BAD_KEY,
        '--file',
        configFile,
      ]);
      expect(process.exitCode).toBe(1);
      expect(errors.join('\n')).toMatch(/checksum/i);
      expect(fs.existsSync(configFile)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('resolves an address-book name for batch-mint', async () => {
    saveAccount('treasury', OTHER_KEY, configFile);

    const command = createBatchMintCommand();
    command.exitOverride();
    await command.parseAsync([
      'node',
      'batch-mint',
      '--contract-id',
      'CABC123',
      '--source',
      'S...',
      '--recipient',
      'treasury:25',
    ]);

    expect(command.opts().recipient).toEqual([{ to: OTHER_KEY, amount: '25' }]);
  });

  it('rejects a bad checksum on a batch-mint recipient', async () => {
    const command = createBatchMintCommand();
    command.exitOverride();
    await expect(
      command.parseAsync([
        'node',
        'batch-mint',
        '--contract-id',
        'CABC123',
        '--source',
        'S...',
        '--recipient',
        `${BAD_KEY}:10`,
      ])
    ).rejects.toThrow(/checksum/i);
  });

  it('resolves an address-book name when init saves the admin', async () => {
    saveAccount('ops', VALID_KEY, configFile);

    const result = await runInit({
      cwd: tmpDir,
      interactive: false,
      flags: {
        admin: 'ops',
        name: 'Named Token',
        symbol: 'NMD',
        initialSupply: '1',
      },
    });

    expect(result.config.admin).toBe(VALID_KEY);
  });

  it('rejects a bad checksum in .bc-forge.json accounts before saving', () => {
    const target = path.join(tmpDir, '.bc-forge.json');
    const result = saveConfigFile(
      {
        name: 'Token',
        symbol: 'TK',
        accounts: { treasury: BAD_KEY },
      },
      target
    );

    expect(result.success).toBe(false);
    expect(result.errors?.join('\n')).toMatch(/checksum/i);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('saves a valid accounts map in .bc-forge.json', () => {
    const target = path.join(tmpDir, '.bc-forge.json');
    const result = saveConfigFile(
      {
        name: 'Token',
        symbol: 'TK',
        accounts: { treasury: VALID_KEY },
      },
      target
    );

    expect(result.success).toBe(true);
    const written = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(written.accounts.treasury).toBe(VALID_KEY);
  });
});
