import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildDeploymentArtifacts,
  exportDeploymentsToFile,
  loadDeploymentsFromFile,
  DeploymentArtifacts,
} from '../utils/deployments.js';
import { createExportDeploymentsCommand } from '../commands/export-deployments.js';

describe('Deployments Export Utilities & Command', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deployments-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('buildDeploymentArtifacts', () => {
    it('constructs a complete deployment artifact payload', () => {
      const artifact = buildDeploymentArtifacts({
        network: 'testnet',
        rpcUrl: 'https://soroban-testnet.stellar.org',
        vaultContractId: 'CVAULT12345',
        vaultWasmHash: 'hashvault123',
        feeContractId: 'CFEE12345',
        feeWasmHash: 'hashfee123',
        linkTxHash: 'txlink123',
      });

      expect(artifact.version).toBe('1.0.0');
      expect(artifact.network).toBe('testnet');
      expect(artifact.rpcUrl).toBe('https://soroban-testnet.stellar.org');
      expect(artifact.timestamp).toBeDefined();
      expect(artifact.contracts.vault).toEqual({
        contractId: 'CVAULT12345',
        wasmHash: 'hashvault123',
        deployedAt: expect.any(String),
      });
      expect(artifact.contracts.fee).toEqual({
        contractId: 'CFEE12345',
        wasmHash: 'hashfee123',
        deployedAt: expect.any(String),
      });
      expect(artifact.txHashes).toEqual({
        linkTxHash: 'txlink123',
      });
    });
  });

  describe('exportDeploymentsToFile & loadDeploymentsFromFile', () => {
    it('saves deployment artifacts to JSON file and loads them back', () => {
      const targetFile = path.join(tmpDir, 'deployments.json');
      const artifacts: DeploymentArtifacts = {
        version: '1.0.0',
        network: 'testnet',
        timestamp: new Date().toISOString(),
        contracts: {
          token: {
            contractId: 'CTOKEN123',
            wasmHash: 'wasmhash123',
          },
        },
        txHashes: {
          deployTx: 'tx123456',
        },
      };

      const result = exportDeploymentsToFile(artifacts, targetFile);
      expect(result.success).toBe(true);
      expect(result.filePath).toBe(path.resolve(targetFile));
      expect(fs.existsSync(targetFile)).toBe(true);

      const loadResult = loadDeploymentsFromFile(targetFile);
      expect(loadResult.success).toBe(true);
      expect(loadResult.artifacts).toEqual(artifacts);
    });

    it('handles overwrites safely without leaving temporary files', () => {
      const targetFile = path.join(tmpDir, 'deployments.json');
      const initialArtifacts: DeploymentArtifacts = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        contracts: {
          vault: { contractId: 'OLD_VAULT_ID' },
        },
      };

      // First write
      exportDeploymentsToFile(initialArtifacts, targetFile);
      expect(fs.readFileSync(targetFile, 'utf-8')).toContain('OLD_VAULT_ID');

      // Overwrite
      const updatedArtifacts: DeploymentArtifacts = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        contracts: {
          vault: { contractId: 'NEW_VAULT_ID' },
        },
      };

      const overwriteResult = exportDeploymentsToFile(updatedArtifacts, targetFile);
      expect(overwriteResult.success).toBe(true);
      expect(fs.readFileSync(targetFile, 'utf-8')).toContain('NEW_VAULT_ID');
      expect(fs.readFileSync(targetFile, 'utf-8')).not.toContain('OLD_VAULT_ID');

      // Check no .tmp files remain in tmpDir
      const filesInDir = fs.readdirSync(tmpDir);
      const tmpFiles = filesInDir.filter((f) => f.endsWith('.tmp'));
      expect(tmpFiles).toHaveLength(0);
    });

    it('creates missing nested target directories', () => {
      const nestedFile = path.join(tmpDir, 'nested', 'sub', 'deployments.json');
      const artifacts: DeploymentArtifacts = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        contracts: {
          vault: { contractId: 'CNESTED123' },
        },
      };

      const result = exportDeploymentsToFile(artifacts, nestedFile);
      expect(result.success).toBe(true);
      expect(fs.existsSync(nestedFile)).toBe(true);
    });

    it('returns error when loading from a non-existent file', () => {
      const result = loadDeploymentsFromFile(path.join(tmpDir, 'non-existent.json'));
      expect(result.success).toBe(false);
      expect(result.error).toContain('Deployment file not found');
    });

    it('returns error when loading invalid JSON content', () => {
      const invalidFile = path.join(tmpDir, 'invalid.json');
      fs.writeFileSync(invalidFile, '{ broken json', 'utf-8');

      const result = loadDeploymentsFromFile(invalidFile);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to read or parse deployment file');
    });

    it('returns error when loading non-object or missing contracts field JSON', () => {
      const invalidSchemaFile = path.join(tmpDir, 'bad-schema.json');
      fs.writeFileSync(invalidSchemaFile, JSON.stringify({ foo: 'bar' }), 'utf-8');

      const result = loadDeploymentsFromFile(invalidSchemaFile);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid deployment JSON schema');
    });
  });

  describe('export-deployments Command', () => {
    it('exports deployment artifacts via CLI options', async () => {
      const targetPath = path.join(tmpDir, 'deployments-cli.json');
      const cmd = createExportDeploymentsCommand();

      await cmd.parseAsync([
        'node',
        'export-deployments',
        '--out',
        targetPath,
        '--vault-id',
        'CVAULT_CLI_TEST',
        '--fee-id',
        'CFEE_CLI_TEST',
        '--tx-hash',
        '0x123456789abcdef',
        '--network',
        'testnet',
      ]);

      const loadResult = loadDeploymentsFromFile(targetPath);
      expect(loadResult.success).toBe(true);
      expect(loadResult.artifacts?.contracts.vault.contractId).toBe('CVAULT_CLI_TEST');
      expect(loadResult.artifacts?.contracts.fee.contractId).toBe('CFEE_CLI_TEST');
      expect(loadResult.artifacts?.txHashes?.exportTxHash).toBe('0x123456789abcdef');
      expect(loadResult.artifacts?.network).toBe('testnet');
    });
  });
});
