// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Keypair, Account, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { TransactionQueue } from './utils';

describe('TransactionQueue (#1528)', () => {
  const rpcUrl = 'https://soroban-testnet.stellar.org';
  const keypair1 = Keypair.random();
  const keypair2 = Keypair.random();

  let mockGetAccount: jest.MockedFunction<(address: string) => Promise<Account>>;

  beforeEach(() => {
    mockGetAccount = jest.fn(async (pubkey: string) => {
      return new Account(pubkey, '100');
    });
    jest.spyOn(SorobanRpc.Server.prototype, 'getAccount').mockImplementation(mockGetAccount);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches initial sequence from RPC and increments locally for subsequent calls', async () => {
    const queue = new TransactionQueue(rpcUrl);

    const acc1 = await queue.getNextAccount(keypair1.publicKey());
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
    expect(acc1.sequenceNumber()).toBe('100');
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(101n);

    const acc2 = await queue.getNextAccount(keypair1.publicKey());
    expect(mockGetAccount).toHaveBeenCalledTimes(1); // cached, no new RPC call
    expect(acc2.sequenceNumber()).toBe('101');
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(102n);

    const acc3 = await queue.getNextAccount(keypair1.publicKey());
    expect(acc3.sequenceNumber()).toBe('102');
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(103n);
  });

  it('serializes concurrent operations and gives each strictly increasing sequence numbers', async () => {
    const queue = new TransactionQueue(rpcUrl);
    const executionOrder: number[] = [];
    const sequencesSeen: string[] = [];

    const op1 = queue.enqueue(keypair1.publicKey(), async (acc) => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      executionOrder.push(1);
      sequencesSeen.push(acc.sequenceNumber());
      return 'res1';
    });

    const op2 = queue.enqueue(keypair1.publicKey(), async (acc) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      executionOrder.push(2);
      sequencesSeen.push(acc.sequenceNumber());
      return 'res2';
    });

    const op3 = queue.enqueue(keypair1.publicKey(), async (acc) => {
      executionOrder.push(3);
      sequencesSeen.push(acc.sequenceNumber());
      return 'res3';
    });

    const results = await Promise.all([op1, op2, op3]);

    expect(results).toEqual(['res1', 'res2', 'res3']);
    expect(executionOrder).toEqual([1, 2, 3]);
    expect(sequencesSeen).toEqual(['100', '101', '102']);
    expect(mockGetAccount).toHaveBeenCalledTimes(1);
  });

  it('invalidates sequence cache on rejection and refetches latest on-chain state', async () => {
    const queue = new TransactionQueue(rpcUrl);

    // Initial successful call
    const res1 = await queue.enqueue(keypair1.publicKey(), async (acc) => {
      return acc.sequenceNumber();
    });
    expect(res1).toBe('100');
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(101n);

    // Second call fails (simulating txBAD_SEQ or network error)
    await expect(
      queue.enqueue(keypair1.publicKey(), async () => {
        throw new Error('txBAD_SEQ');
      }),
    ).rejects.toThrow('txBAD_SEQ');

    // Sequence cache must be invalidated
    expect(queue.getCachedSequence(keypair1.publicKey())).toBeUndefined();

    // Next call must refetch from RPC
    mockGetAccount.mockResolvedValueOnce(new Account(keypair1.publicKey(), '200'));
    const res3 = await queue.enqueue(keypair1.publicKey(), async (acc) => {
      return acc.sequenceNumber();
    });

    expect(res3).toBe('200');
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(201n);
  });

  it('invalidates sequence cache when operation returns a failure result object', async () => {
    const queue = new TransactionQueue(rpcUrl);

    await queue.enqueue(keypair1.publicKey(), async (acc) => {
      return { success: false, hash: 'failed-hash', seq: acc.sequenceNumber() };
    });

    // Cache should be invalidated because success was false
    expect(queue.getCachedSequence(keypair1.publicKey())).toBeUndefined();
  });

  it('runs queues for different accounts independently', async () => {
    const queue = new TransactionQueue(rpcUrl);
    mockGetAccount.mockImplementation(async (pubkey: string) => {
      if (pubkey === keypair1.publicKey()) return new Account(pubkey, '100');
      return new Account(pubkey, '500');
    });

    const [res1, res2] = await Promise.all([
      queue.enqueue(keypair1.publicKey(), async (acc) => acc.sequenceNumber()),
      queue.enqueue(keypair2.publicKey(), async (acc) => acc.sequenceNumber()),
    ]);

    expect(res1).toBe('100');
    expect(res2).toBe('500');
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(101n);
    expect(queue.getCachedSequence(keypair2.publicKey())).toBe(501n);
  });

  it('clears all cached state when clear() is called', async () => {
    const queue = new TransactionQueue(rpcUrl);
    await queue.getNextAccount(keypair1.publicKey());
    expect(queue.getCachedSequence(keypair1.publicKey())).toBe(101n);

    queue.clear();
    expect(queue.getCachedSequence(keypair1.publicKey())).toBeUndefined();
  });
});
