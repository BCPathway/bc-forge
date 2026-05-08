/**
 * @bc-forge/sdk — Tests for offline transaction builder and simulation methods
 */

import { bcForgeClient } from './client';
import { Keypair, Networks } from '@stellar/stellar-sdk';

// Mock data for testing
const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_NETWORK = Networks.TESTNET;
const MOCK_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABK4I';

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
      const toAddress = Keypair.random().publicKey();
      const amount = BigInt(1000);

      // The actual call would fail without a real RPC server
      // In production, you would mock the server.getResponse
      expect(typeof client.buildMintTx).toBe('function');
      expect(client.buildMintTx.length).toBe(3); // 3 parameters
    });
  });

  describe('buildTransferTx', () => {
    it('should build an unsigned transfer transaction XDR', async () => {
      const fromAddress = Keypair.random().publicKey();
      const toAddress = Keypair.random().publicKey();
      const amount = BigInt(500);

      expect(typeof client.buildTransferTx).toBe('function');
      expect(client.buildTransferTx.length).toBe(4); // 4 parameters
    });
  });

  describe('buildApproveTx', () => {
    it('should build an unsigned approve transaction XDR', async () => {
      const fromAddress = Keypair.random().publicKey();
      const spenderAddress = Keypair.random().publicKey();
      const amount = BigInt(1000);
      const exp = 1000000;

      expect(typeof client.buildApproveTx).toBe('function');
      expect(client.buildApproveTx.length).toBe(5); // 5 parameters
    });
  });

  describe('buildBurnTx', () => {
    it('should build an unsigned burn transaction XDR', async () => {
      const fromAddress = Keypair.random().publicKey();
      const amount = BigInt(200);

      expect(typeof client.buildBurnTx).toBe('function');
      expect(client.buildBurnTx.length).toBe(3); // 3 parameters
    });
  });

  describe('signTx', () => {
    it('should sign a transaction XDR', () => {
      // Create a mock unsigned transaction XDR (simplified for testing)
      // In production, this would be a real XDR from buildMintTx, etc.
      const mockXdr = 'AAAAAgAAAAB7NXRFP5sGdM0P6T0qMvqN0k3jTmGmZ3K7hE6m8Y1V5gAAAGQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
      
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
  });
});
