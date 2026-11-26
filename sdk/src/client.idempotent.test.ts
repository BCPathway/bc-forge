// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Tests for submitIdempotent (issue #1484)
 *
 * Verifies that submitIdempotent:
 *   1. Returns an existing receipt without re-broadcasting when the tx is already mined.
 *   2. Submits normally when the tx is not yet on-chain (NOT_FOUND).
 *   3. Falls back gracefully when XDR cannot be parsed.
 *   4. Falls back gracefully when the RPC lookup throws.
 *   5. Returns a failure receipt for already-failed on-chain transactions.
 */

import { jest } from '@jest/globals';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

// ── ESM-compatible module mock (same pattern as client.regression.test.ts) ──
jest.unstable_mockModule('./utils', () => ({
  buildInvokeTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  addressToScVal: jest.fn((v: string) => v),
  i128ToScVal: jest.fn((v: bigint) => v),
  stringToScVal: jest.fn((v: string) => v),
  u32ToScVal: jest.fn((v: number) => v),
  scValToNative: jest.fn(() => undefined),
  buildUnsignedTransaction: jest.fn(),
  signTransaction: jest.fn(),
  simulateTransaction: jest.fn(),
  simulationToDryRun: jest.fn(),
  hashToScVal: jest.fn(),
  TransactionQueue: class MockTransactionQueue {
    enqueue = jest.fn((_pubkey: string, fn: (acc?: any) => any) => fn());
    invalidateSequence = jest.fn();
    clear = jest.fn();
  },
}));

// Lazy-loaded after the mock is in place.
let utils: typeof import('./utils');
let bcForgeClient: typeof import('./client').bcForgeClient;

const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_NETWORK = 'Test SDF Network ; September 2015';
const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

function makeClient() {
  return new bcForgeClient({
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: MOCK_NETWORK,
    contractId: MOCK_CONTRACT_ID,
  });
}

describe('bcForgeClient.submitIdempotent', () => {
  let mockedSubmitTransaction: ReturnType<typeof jest.mocked<typeof utils.submitTransaction>>;

  beforeAll(async () => {
    utils = await import('./utils');
    const clientMod = await import('./client');
    bcForgeClient = clientMod.bcForgeClient;
    mockedSubmitTransaction = jest.mocked(utils.submitTransaction);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('is defined and callable', () => {
    const client = makeClient();
    expect(typeof client.submitIdempotent).toBe('function');
  });

  it('returns an existing SUCCESS receipt without re-submitting', async () => {
    const existingHash = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';

    // Patch fromXDR so the hash can be derived.
    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const fakeHash = Buffer.from(existingHash, 'hex');
    const fromXDRSpy = jest
      .spyOn(TransactionBuilder, 'fromXDR')
      .mockReturnValue({ hash: () => fakeHash } as unknown as ReturnType<
        typeof TransactionBuilder.fromXDR
      >);

    // RPC returns SUCCESS for the hash lookup.
    const getTransactionSpy = jest
      .spyOn(SorobanRpc.Server.prototype, 'getTransaction')
      .mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: undefined,
        txHash: existingHash,
      } as unknown as Awaited<ReturnType<typeof SorobanRpc.Server.prototype.getTransaction>>);

    const client = makeClient();
    const result = await client.submitIdempotent('FAKE_XDR');

    // submitTransaction must NOT be called — existing receipt is returned.
    expect(mockedSubmitTransaction).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.hash).toBe(existingHash);

    fromXDRSpy.mockRestore();
    getTransactionSpy.mockRestore();
  });

  it('submits normally when transaction is not yet on-chain (NOT_FOUND)', async () => {
    const freshHash = '1122334455667788990011223344556677889900112233445566778899001122';

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const fakeHash = Buffer.from(freshHash, 'hex');
    const fromXDRSpy = jest
      .spyOn(TransactionBuilder, 'fromXDR')
      .mockReturnValue({ hash: () => fakeHash } as unknown as ReturnType<
        typeof TransactionBuilder.fromXDR
      >);

    const getTransactionSpy = jest
      .spyOn(SorobanRpc.Server.prototype, 'getTransaction')
      .mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.NOT_FOUND,
      } as unknown as Awaited<ReturnType<typeof SorobanRpc.Server.prototype.getTransaction>>);

    // submitTransaction resolves with a SUCCESS ledger response.
    mockedSubmitTransaction.mockResolvedValueOnce({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: undefined,
      txHash: freshHash,
    } as unknown as Awaited<ReturnType<typeof utils.submitTransaction>>);

    const client = makeClient();
    const result = await client.submitIdempotent('FAKE_XDR');

    expect(mockedSubmitTransaction).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.hash).toBe(freshHash);

    fromXDRSpy.mockRestore();
    getTransactionSpy.mockRestore();
  });

  it('falls back to plain submission when XDR cannot be parsed', async () => {
    const fallbackHash = 'feeddeadbeef00000000000000000000feeddeadbeef00000000000000000000';

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    jest.spyOn(TransactionBuilder, 'fromXDR').mockImplementation(() => {
      throw new Error('invalid XDR');
    });

    mockedSubmitTransaction.mockResolvedValueOnce({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: undefined,
      txHash: fallbackHash,
    } as unknown as Awaited<ReturnType<typeof utils.submitTransaction>>);

    const client = makeClient();
    const result = await client.submitIdempotent('BAD_XDR');

    expect(mockedSubmitTransaction).toHaveBeenCalledTimes(1);
    expect(result.hash).toBe(fallbackHash);
  });

  it('falls back to submission when getTransaction RPC call throws', async () => {
    const rpcFallbackHash = 'cafecafecafecafe00000000000000000000000000000000cafecafecafecafe';

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const fakeHash = Buffer.from(rpcFallbackHash, 'hex');
    const fromXDRSpy = jest
      .spyOn(TransactionBuilder, 'fromXDR')
      .mockReturnValue({ hash: () => fakeHash } as unknown as ReturnType<
        typeof TransactionBuilder.fromXDR
      >);

    const getTransactionSpy = jest
      .spyOn(SorobanRpc.Server.prototype, 'getTransaction')
      .mockRejectedValue(new Error('RPC timeout'));

    mockedSubmitTransaction.mockResolvedValueOnce({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: undefined,
      txHash: rpcFallbackHash,
    } as unknown as Awaited<ReturnType<typeof utils.submitTransaction>>);

    const client = makeClient();
    const result = await client.submitIdempotent('FAKE_XDR');

    expect(mockedSubmitTransaction).toHaveBeenCalledTimes(1);
    expect(result.hash).toBe(rpcFallbackHash);

    fromXDRSpy.mockRestore();
    getTransactionSpy.mockRestore();
  });

  it('returns failure receipt for an already-failed on-chain transaction', async () => {
    const failedHash = 'deaddeaddeaddead00000000000000000000000000000000deaddeaddeaddead';

    const { TransactionBuilder } = await import('@stellar/stellar-sdk');
    const fakeHash = Buffer.from(failedHash, 'hex');
    const fromXDRSpy = jest
      .spyOn(TransactionBuilder, 'fromXDR')
      .mockReturnValue({ hash: () => fakeHash } as unknown as ReturnType<
        typeof TransactionBuilder.fromXDR
      >);

    const getTransactionSpy = jest
      .spyOn(SorobanRpc.Server.prototype, 'getTransaction')
      .mockResolvedValue({
        status: SorobanRpc.Api.GetTransactionStatus.FAILED,
        txHash: failedHash,
      } as unknown as Awaited<ReturnType<typeof SorobanRpc.Server.prototype.getTransaction>>);

    const client = makeClient();
    const result = await client.submitIdempotent('FAKE_XDR');

    // No broadcast — FAILED receipt returned immediately.
    expect(mockedSubmitTransaction).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.hash).toBe(failedHash);

    fromXDRSpy.mockRestore();
    getTransactionSpy.mockRestore();
  });
});
