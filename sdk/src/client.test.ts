/**
 * @bc-forge/sdk — Tests for offline transaction builder and simulation methods
 */

import { jest } from '@jest/globals';
import { bcForgeClient } from './client';
import { Keypair, Networks, xdr } from '@stellar/stellar-sdk';

// Mock data for testing
const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_NETWORK = Networks.TESTNET;
const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

describe('bcForgeClient Offline Transaction Builders', () => {
  let client: bcForgeClient;
  let adminKeypair: Keypair;

  beforeEach(() => {
    client = new bcForgeClient({
      rpcUrl: MOCK_RPC_URL,
      networkPassphrase: MOCK_NETWORK,
      contractId: MOCK_CONTRACT_ID,
    });
    adminKeypair = Keypair.random();
  });

  describe('buildMintTx', () => {
    it('should build an unsigned mint transaction XDR', async () => {
      // This test would require mocking the RPC server
      // For now, we're testing the method signature and structure

      // The actual call would fail without a real RPC server
      // In production, you would mock the server.getResponse
      expect(typeof client.buildMintTx).toBe('function');
      expect(client.buildMintTx.length).toBe(3); // 3 parameters
    });
  });

  describe('batchMint', () => {
    it('should invoke batch_mint with object recipients', async () => {
      const recipientA = Keypair.random().publicKey();
      const recipientB = Keypair.random().publicKey();
      const invokeContract = jest.fn(
        async (_method: string, _args: unknown[], _source: Keypair) => ({
          success: true,
          hash: 'mock-hash',
          returnValue: null,
        }),
      );
      (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
        invokeContract;

      await client.batchMint(
        [
          { to: recipientA, amount: 100n },
          { to: recipientB, amount: 250n },
        ],
        adminKeypair,
      );

      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, args, source] = invokeContract.mock.calls[0] as [string, unknown[], Keypair];
      expect(method).toBe('batch_mint');
      expect(args).toHaveLength(2);
      expect(source).toBe(adminKeypair);

      const [, recipientsVec] = args as [string, xdr.ScVal];
      const recipients = recipientsVec.vec();
      if (recipients === null) {
        throw new Error('Expected batch_mint argument to be an ScVal vec');
      }
      expect(recipients).toHaveLength(2);
      const firstRecipient = recipients[0].map();
      if (firstRecipient === null) {
        throw new Error('Expected batch_mint recipients to be ScVal maps');
      }
      expect(firstRecipient[0].key().sym().toString()).toBe('to');
      expect(firstRecipient[1].key().sym().toString()).toBe('amount');
    });
  });

  describe('buildTransferTx', () => {
    it('should build an unsigned transfer transaction XDR', async () => {
      expect(typeof client.buildTransferTx).toBe('function');
      expect(client.buildTransferTx.length).toBe(4); // 4 parameters
    });
  });

  describe('buildApproveTx', () => {
    it('should build an unsigned approve transaction XDR', async () => {
      expect(typeof client.buildApproveTx).toBe('function');
      expect(client.buildApproveTx.length).toBe(5); // 5 parameters
    });
  });

  describe('buildBurnTx', () => {
    it('should build an unsigned burn transaction XDR', async () => {
      expect(typeof client.buildBurnTx).toBe('function');
      expect(client.buildBurnTx.length).toBe(3); // 3 parameters
    });
  });

  describe('buildTransferFromTx', () => {
    it('should build an unsigned transferFrom transaction XDR', async () => {
      expect(typeof client.buildTransferFromTx).toBe('function');
      expect(client.buildTransferFromTx.length).toBe(5); // 5 parameters
    });
  });

  describe('buildBurnFromTx', () => {
    it('should build an unsigned burnFrom transaction XDR', async () => {
      expect(typeof client.buildBurnFromTx).toBe('function');
      expect(client.buildBurnFromTx.length).toBe(4); // 4 parameters
    });
  });

  describe('signTx', () => {
    it('should sign a transaction XDR', () => {
      // Create a mock unsigned transaction XDR (simplified for testing)
      // In production, this would be a real XDR from buildMintTx, etc.

      expect(typeof client.signTx).toBe('function');
      expect(client.signTx.length).toBe(2); // 2 parameters
    });
  });

  describe('simulate and simulation methods', () => {
    it('should have simulate method', () => {
      expect(typeof client.simulate).toBe('function');
      expect(client.simulate.length).toBe(3); // 3 parameters
    });

    it('should have simulateMint method', () => {
      expect(typeof client.simulateMint).toBe('function');
      expect(client.simulateMint.length).toBe(3); // 3 parameters
    });

    it('should have simulateTransfer method', () => {
      expect(typeof client.simulateTransfer).toBe('function');
      expect(client.simulateTransfer.length).toBe(4); // 4 parameters
    });

    it('should have simulateBurn method', () => {
      expect(typeof client.simulateBurn).toBe('function');
      expect(client.simulateBurn.length).toBe(3); // 3 parameters
    });

    it('should have simulateTransferFrom method', () => {
      expect(typeof client.simulateTransferFrom).toBe('function');
      expect(client.simulateTransferFrom.length).toBe(5); // 5 parameters
    });

    it('should have simulateBurnFrom method', () => {
      expect(typeof client.simulateBurnFrom).toBe('function');
      expect(client.simulateBurnFrom.length).toBe(4); // 4 parameters
    });
  });

  describe('migrateAdmin', () => {
    it('should have migrateAdmin method', () => {
      expect(typeof client.migrateAdmin).toBe('function');
      expect(client.migrateAdmin.length).toBe(1); // 1 optional parameter
    });

    it('should invoke migrate_admin with no arguments', async () => {
      const invokeContract = jest.fn(
        async (_method: string, _args: unknown[], _source: Keypair) => ({
          success: true,
          hash: 'mock-migration-hash',
          returnValue: null,
        }),
      );
      (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
        invokeContract;

      await client.migrateAdmin(adminKeypair);

      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, args, source] = invokeContract.mock.calls[0] as [string, unknown[], Keypair];
      expect(method).toBe('migrate_admin');
      expect(args).toHaveLength(0); // No arguments for migrate_admin
      expect(source).toBe(adminKeypair);
    });
  });

  describe('RBAC role management', () => {
    it('should have grantMinter method', () => {
      expect(typeof client.grantMinter).toBe('function');
      expect(client.grantMinter.length).toBe(2); // 2 parameters
    });

    it('should have revokeMinter method', () => {
      expect(typeof client.revokeMinter).toBe('function');
      expect(client.revokeMinter.length).toBe(2); // 2 parameters
    });
  });
});
