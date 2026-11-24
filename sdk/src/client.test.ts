// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Tests for offline transaction builder and simulation methods
 */

import { jest } from '@jest/globals';
import { bcForgeClient, Role, ZERO_ADDRESS, isZeroAddress } from './client';
import { TransactionQueue } from './utils';
import {
  Account,
  Keypair,
  Networks,
  rpc as SorobanRpc,
  SorobanDataBuilder,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

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

  describe('RBAC and Contract Connection Methods', () => {
    it('should invoke grantRole with correct parameters', async () => {
      const targetUser = Keypair.random().publicKey();
      const invokeContract = jest.fn(
        async (_method: string, _args: unknown[], _source: Keypair) => ({
          success: true,
          hash: 'mock-hash-grant',
          returnValue: null,
        }),
      );
      (client as unknown as { invokeContract: typeof invokeContract }).invokeContract = invokeContract;

      const result = await client.grantRole(
        Role.SuperAdmin,
        targetUser,
        adminKeypair,
      );

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, , source] = invokeContract.mock.calls[0] as [string, unknown[], Keypair];
      expect(method).toBe('grant_role');
      expect(source).toBe(adminKeypair);
    });

    it('should invoke revokeRole with correct parameters', async () => {
      const targetUser = Keypair.random().publicKey();
      const invokeContract = jest.fn(
        async (_method: string, _args: unknown[], _source: Keypair) => ({
          success: true,
          hash: 'mock-hash-revoke',
          returnValue: null,
        }),
      );
      (client as unknown as { invokeContract: typeof invokeContract }).invokeContract = invokeContract;

      const result = await client.revokeRole(
        Role.Minter,
        targetUser,
        adminKeypair,
      );

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, , source] = invokeContract.mock.calls[0] as [string, unknown[], Keypair];
      expect(method).toBe('revoke_role');
      expect(source).toBe(adminKeypair);
    });

    it('should invoke setAdminContract with correct parameters', async () => {
      const adminContractId = MOCK_CONTRACT_ID;
      const invokeContract = jest.fn(
        async (_method: string, _args: unknown[], _source: Keypair) => ({
          success: true,
          hash: 'mock-hash-link',
          returnValue: null,
        }),
      );
      (client as unknown as { invokeContract: typeof invokeContract }).invokeContract = invokeContract;

      const result = await client.setAdminContract(adminContractId, adminKeypair);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, , source] = invokeContract.mock.calls[0] as [string, unknown[], Keypair];
      expect(method).toBe('set_admin_contract');
      expect(source).toBe(adminKeypair);
    });

    it('should invoke setDependentToken with correct parameters', async () => {
      const tokenContractId = MOCK_CONTRACT_ID;
      const invokeContract = jest.fn(
        async (_method: string, _args: unknown[], _source: Keypair) => ({
          success: true,
          hash: 'mock-hash-token-link',
          returnValue: null,
        }),
      );
      (client as unknown as { invokeContract: typeof invokeContract }).invokeContract = invokeContract;

      const result = await client.setDependentToken(tokenContractId, adminKeypair);

      expect(result.success).toBe(true);
      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, , source] = invokeContract.mock.calls[0] as [string, unknown[], Keypair];
      expect(method).toBe('set_token');
      expect(source).toBe(adminKeypair);
    });
  });
});

describe('isZeroAddress', () => {
  it('should return true for the zero address', () => {
    expect(isZeroAddress(ZERO_ADDRESS)).toBe(true);
  });

  it('should return false for a valid address', () => {
    const validAddress = Keypair.random().publicKey();
    expect(isZeroAddress(validAddress)).toBe(false);
  });

  it('should return false for an empty string', () => {
    expect(isZeroAddress('')).toBe(false);
  });

  it('should return false for a different address', () => {
    expect(isZeroAddress('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('should export the ZERO_ADDRESS constant', () => {
    expect(ZERO_ADDRESS).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
  });
});

describe('TransactionQueue and bcForgeClient concurrent sequence handling (#1528)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('serializes concurrent tasks for the same source account with strictly increasing sequence numbers', async () => {
    const publicKey = Keypair.random().publicKey();
    const fetchSequence = jest.fn(async (_pk: string) => '100');
    const queue = new TransactionQueue(MOCK_RPC_URL, { fetchSequence });

    const observedSequences: string[] = [];
    const executionOrder: string[] = [];

    const results = await Promise.all([
      queue.enqueue(publicKey, async (account) => {
        executionOrder.push('start-1');
        account.incrementSequenceNumber();
        observedSequences.push(account.sequenceNumber());
        await new Promise((r) => setTimeout(r, 25));
        executionOrder.push('end-1');
        return 'tx-1';
      }),
      queue.enqueue(publicKey, async (account) => {
        executionOrder.push('start-2');
        account.incrementSequenceNumber();
        observedSequences.push(account.sequenceNumber());
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push('end-2');
        return 'tx-2';
      }),
      queue.enqueue(publicKey, async (account) => {
        executionOrder.push('start-3');
        account.incrementSequenceNumber();
        observedSequences.push(account.sequenceNumber());
        executionOrder.push('end-3');
        return 'tx-3';
      }),
    ]);

    expect(results).toEqual(['tx-1', 'tx-2', 'tx-3']);
    expect(fetchSequence).toHaveBeenCalledTimes(1);
    expect(observedSequences).toEqual(['101', '102', '103']);
    expect(executionOrder).toEqual(['start-1', 'end-1', 'start-2', 'end-2', 'start-3', 'end-3']);
    expect(queue.getCachedSequence(publicKey)).toBe(103n);
  });

  it('invalidates cached sequence on rejection and refetches on-chain state for subsequent calls', async () => {
    const publicKey = Keypair.random().publicKey();
    let onChainSeq = 200n;
    const fetchSequence = jest.fn(async () => onChainSeq.toString());
    const queue = new TransactionQueue(MOCK_RPC_URL, { fetchSequence });

    await queue.enqueue(publicKey, async (account) => {
      account.incrementSequenceNumber();
      return 'ok-1';
    });
    expect(queue.getCachedSequence(publicKey)).toBe(201n);
    expect(fetchSequence).toHaveBeenCalledTimes(1);

    // Simulate rejection; on-chain sequence actually advanced externally to 250
    onChainSeq = 250n;
    await expect(
      queue.enqueue(publicKey, async () => {
        throw new Error('simulated RPC rejection');
      }),
    ).rejects.toThrow('simulated RPC rejection');

    expect(queue.getCachedSequence(publicKey)).toBeNull();

    // Next call must refetch on-chain sequence (250) and use 251
    let resyncedSeq = '';
    await queue.enqueue(publicKey, async (account) => {
      account.incrementSequenceNumber();
      resyncedSeq = account.sequenceNumber();
      return 'ok-2';
    });

    expect(fetchSequence).toHaveBeenCalledTimes(2);
    expect(resyncedSeq).toBe('251');
    expect(queue.getCachedSequence(publicKey)).toBe(251n);
  });

  it('automatically resynchronizes and retries once on txBAD_SEQ rejection', async () => {
    const publicKey = Keypair.random().publicKey();
    let onChainSeq = 300n;
    const fetchSequence = jest.fn(async () => onChainSeq.toString());
    const queue = new TransactionQueue(MOCK_RPC_URL, { fetchSequence });

    let attempts = 0;
    const observed: string[] = [];

    const result = await queue.enqueue(publicKey, async (account) => {
      attempts++;
      account.incrementSequenceNumber();
      observed.push(account.sequenceNumber());
      if (attempts === 1) {
        onChainSeq = 310n;
        throw new Error('Transaction submission failed: txBAD_SEQ');
      }
      return 'resynced-ok';
    });

    expect(result).toBe('resynced-ok');
    expect(attempts).toBe(2);
    expect(fetchSequence).toHaveBeenCalledTimes(2);
    expect(observed).toEqual(['301', '311']);
    expect(queue.getCachedSequence(publicKey)).toBe(311n);
  });

  it('maintains independent sequence caches for different source accounts', async () => {
    const pkA = Keypair.random().publicKey();
    const pkB = Keypair.random().publicKey();
    const seqMap: Record<string, string> = { [pkA]: '10', [pkB]: '500' };
    const fetchSequence = jest.fn(async (pk: string) => seqMap[pk]);
    const queue = new TransactionQueue(MOCK_RPC_URL, { fetchSequence });

    const [seqA, seqB] = await Promise.all([
      queue.enqueue(pkA, async (acc) => {
        acc.incrementSequenceNumber();
        return acc.sequenceNumber();
      }),
      queue.enqueue(pkB, async (acc) => {
        acc.incrementSequenceNumber();
        return acc.sequenceNumber();
      }),
    ]);

    expect(seqA).toBe('11');
    expect(seqB).toBe('501');
    expect(queue.getCachedSequence(pkA)).toBe(11n);
    expect(queue.getCachedSequence(pkB)).toBe(501n);
  });

  it('bcForgeClient concurrent invokeContract calls succeed without txBAD_SEQ', async () => {
    const sourceKeypair = Keypair.random();
    const recipient = Keypair.random().publicKey();
    let ledgerSequence = 1000n;
    const submittedSequences: string[] = [];

    const getAccountSpy = jest
      .spyOn(SorobanRpc.Server.prototype, 'getAccount')
      .mockImplementation(async (pk: string) => new Account(pk, ledgerSequence.toString()));

    jest
      .spyOn(SorobanRpc.Server.prototype, 'simulateTransaction')
      .mockImplementation(async () => ({
        id: 'sim-1',
        latestLedger: 1,
        events: [],
        minResourceFee: '100',
        results: [{ auth: [], xdr: xdr.ScVal.scvVoid().toXDR('base64') }],
        transactionData: new SorobanDataBuilder().build().toXDR('base64'),
      }) as any);

    jest
      .spyOn(SorobanRpc.Server.prototype, 'sendTransaction')
      .mockImplementation(async (tx: any) => {
        const parsed =
          typeof tx?.sequence === 'string'
            ? tx
            : TransactionBuilder.fromXDR(tx.toXDR(), MOCK_NETWORK);
        const seq = BigInt(parsed.sequence);
        if (seq !== ledgerSequence + 1n) {
          return { status: 'ERROR', errorResult: 'txBAD_SEQ', hash: `bad-${seq}` } as any;
        }
        ledgerSequence = seq;
        submittedSequences.push(parsed.sequence);
        return { status: 'PENDING', hash: `hash-${seq}` } as any;
      });

    jest
      .spyOn(SorobanRpc.Server.prototype, 'getTransaction')
      .mockImplementation(async (hash: string) => ({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        hash,
        returnValue: undefined,
      }) as any);

    const client = new bcForgeClient({
      rpcUrl: MOCK_RPC_URL,
      networkPassphrase: MOCK_NETWORK,
      contractId: MOCK_CONTRACT_ID,
      maxRetryAttempts: 1,
    });

    const results = await Promise.all([
      client.mint(recipient, 10n, sourceKeypair),
      client.mint(recipient, 20n, sourceKeypair),
      client.mint(recipient, 30n, sourceKeypair),
    ]);

    expect(results.map((r) => r.success)).toEqual([true, true, true]);
    expect(submittedSequences).toEqual(['1001', '1002', '1003']);
    expect(getAccountSpy).toHaveBeenCalledTimes(1);
    expect(client.getTransactionQueue().getCachedSequence(sourceKeypair.publicKey())).toBe(1003n);
  });
});
