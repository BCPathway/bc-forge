// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Keypair, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { submitTransaction } from './utils';
import { TransactionSubmissionError, TokenInsufficientBalanceError } from './errors';

describe('Transaction submission retries (#930)', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('retries transient sequence error (txBAD_SEQ) and can succeed', async () => {
    let attempts = 0;
    jest.spyOn(SorobanRpc.Server.prototype, 'sendTransaction').mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return { status: 'ERROR', errorResult: 'txBAD_SEQ', hash: 'hash1' } as any;
      }
      return { status: 'PENDING', hash: 'hash2' } as any;
    });

    jest.spyOn(SorobanRpc.Server.prototype, 'getTransaction').mockImplementation(async () => {
      return {
        status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
        returnValue: undefined,
        hash: 'hash2',
      } as any;
    });

    jest.spyOn(SorobanRpc.Server.prototype, 'getAccount').mockImplementation(async () => {
      return { sequenceNumber: () => '10', incrementSequenceNumber: () => {} } as any;
    });

    const kp = Keypair.random();

    const res = await submitTransaction('https://soroban-testnet.stellar.org', 'dummyXdr', {
      maxAttempts: 3,
      sourceKeypair: kp,
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
      method: 'mint',
      args: [],
    });

    expect(attempts).toBe(2);
    expect(res.status).toBe(SorobanRpc.Api.GetTransactionStatus.SUCCESS);
  });

  it('contract logic failures (txFAILED / panic) are NOT retried', async () => {
    let attempts = 0;
    jest.spyOn(SorobanRpc.Server.prototype, 'sendTransaction').mockImplementation(async () => {
      attempts++;
      return { status: 'ERROR', errorResult: 'txFAILED Error(Contract, #4)', hash: 'hash1' } as any;
    });

    const kp = Keypair.random();
    await expect(
      submitTransaction('https://soroban-testnet.stellar.org', 'dummyXdr', {
        maxAttempts: 3,
        sourceKeypair: kp,
        contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
        method: 'mint',
        args: [],
      }),
    ).rejects.toThrow(TokenInsufficientBalanceError);

    expect(attempts).toBe(1);
  });

  it('fee bumps respect the configured cap', async () => {
    let attempts = 0;
    jest.spyOn(SorobanRpc.Server.prototype, 'sendTransaction').mockImplementation(async () => {
      attempts++;
      return { status: 'ERROR', errorResult: 'txINSUFFICIENT_FEE', hash: 'hash1' } as any;
    });

    const kp = Keypair.random();
    await expect(
      submitTransaction('https://soroban-testnet.stellar.org', 'dummyXdr', {
        maxAttempts: 3,
        maxFeeCap: 100n,
        sourceKeypair: kp,
        contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
        method: 'mint',
        args: [],
      }),
    ).rejects.toThrow(TransactionSubmissionError);

    expect(attempts).toBe(1);
  });
});
