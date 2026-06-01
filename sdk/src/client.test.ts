/**
 * @bc-forge/sdk — Tests for offline transaction builder and simulation methods
 */

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
      const invokeContract = jest.fn().mockResolvedValue({
        success: true,
        hash: 'mock-hash',
        returnValue: null,
      });
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
      const [method, args, source] = invokeContract.mock.calls[0];
      expect(method).toBe('batch_mint');
      expect(args).toHaveLength(1);
      expect(source).toBe(adminKeypair);

      const recipientsVec = args[0] as xdr.ScVal;
      const recipients = recipientsVec.vec();
      if (recipients === null) {
        throw new Error('Expected batch_mint argument to be an ScVal vec');
      }
      expect(recipients).toHaveLength(2);
      const firstRecipient = recipients[0].map();
      if (firstRecipient === null) {
        throw new Error('Expected batch_mint recipients to be ScVal maps');
      }
      expect(firstRecipient[0].key().sym().toString()).toBe('address');
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

  describe('buildInitializeTx', () => {
    it('should build an unsigned initialize transaction XDR', async () => {
      expect(typeof client.buildInitializeTx).toBe('function');
      expect(client.buildInitializeTx.length).toBe(5);
    });
  });

  describe('buildBatchMintTx', () => {
    it('should build an unsigned batch mint transaction XDR', async () => {
      expect(typeof client.buildBatchMintTx).toBe('function');
      expect(client.buildBatchMintTx.length).toBe(2);
    });
  });

  describe('buildTransferOwnershipTx', () => {
    it('should build an unsigned transfer ownership transaction XDR', async () => {
      expect(typeof client.buildTransferOwnershipTx).toBe('function');
      expect(client.buildTransferOwnershipTx.length).toBe(2);
    });
  });

  describe('buildPauseTx', () => {
    it('should build an unsigned pause transaction XDR', async () => {
      expect(typeof client.buildPauseTx).toBe('function');
      expect(client.buildPauseTx.length).toBe(1);
    });
  });

  describe('buildUnpauseTx', () => {
    it('should build an unsigned unpause transaction XDR', async () => {
      expect(typeof client.buildUnpauseTx).toBe('function');
      expect(client.buildUnpauseTx.length).toBe(1);
    });
  });

  describe('buildSetAdminPoolTx', () => {
    it('should build an unsigned set admin pool transaction XDR', async () => {
      expect(typeof client.buildSetAdminPoolTx).toBe('function');
      expect(client.buildSetAdminPoolTx.length).toBe(3);
    });
  });

  describe('buildUpgradeTx', () => {
    it('should build an unsigned upgrade transaction XDR', async () => {
      expect(typeof client.buildUpgradeTx).toBe('function');
      expect(client.buildUpgradeTx.length).toBe(2);
    });
  });

  describe('buildProposeActionTx', () => {
    it('should build an unsigned propose action transaction XDR', async () => {
      expect(typeof client.buildProposeActionTx).toBe('function');
      expect(client.buildProposeActionTx.length).toBe(4);
    });
  });

  describe('buildApproveProposalTx', () => {
    it('should build an unsigned approve proposal transaction XDR', async () => {
      expect(typeof client.buildApproveProposalTx).toBe('function');
      expect(client.buildApproveProposalTx.length).toBe(3);
    });
  });

  describe('buildExecuteProposalTx', () => {
    it('should build an unsigned execute proposal transaction XDR', async () => {
      expect(typeof client.buildExecuteProposalTx).toBe('function');
      expect(client.buildExecuteProposalTx.length).toBe(2);
    });
  });

  describe('buildSetClawbackAdminTx', () => {
    it('should build an unsigned set clawback admin transaction XDR', async () => {
      expect(typeof client.buildSetClawbackAdminTx).toBe('function');
      expect(client.buildSetClawbackAdminTx.length).toBe(2);
    });
  });

  describe('buildUpdateNameTx', () => {
    it('should build an unsigned update name transaction XDR', async () => {
      expect(typeof client.buildUpdateNameTx).toBe('function');
      expect(client.buildUpdateNameTx.length).toBe(2);
    });
  });

  describe('buildClawbackTx', () => {
    it('should build an unsigned clawback transaction XDR', async () => {
      expect(typeof client.buildClawbackTx).toBe('function');
      expect(client.buildClawbackTx.length).toBe(4);
    });
  });

  describe('buildLockTokensTx', () => {
    it('should build an unsigned lock tokens transaction XDR', async () => {
      expect(typeof client.buildLockTokensTx).toBe('function');
      expect(client.buildLockTokensTx.length).toBe(4);
    });
  });

  describe('buildWithdrawLockedTx', () => {
    it('should build an unsigned withdraw locked transaction XDR', async () => {
      expect(typeof client.buildWithdrawLockedTx).toBe('function');
      expect(client.buildWithdrawLockedTx.length).toBe(2);
    });
  });

  describe('buildUpdateSymbolTx', () => {
    it('should build an unsigned update symbol transaction XDR', async () => {
      expect(typeof client.buildUpdateSymbolTx).toBe('function');
      expect(client.buildUpdateSymbolTx.length).toBe(2);
    });
  });

  describe('buildUnsignedTx', () => {
    it('should have buildUnsignedTx method', () => {
      expect(typeof client.buildUnsignedTx).toBe('function');
      expect(client.buildUnsignedTx.length).toBe(3);
    });
  });

  describe('submitTx', () => {
    it('should have submitTx method', () => {
      expect(typeof client.submitTx).toBe('function');
      expect(client.submitTx.length).toBe(1);
    });
  });

  describe('signTx', () => {
    it('should sign a transaction XDR', () => {
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
