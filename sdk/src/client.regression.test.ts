import { Keypair, SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient } from './client';
import * as utils from './utils';

jest.mock('./utils', () => ({
  buildInvokeTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  addressToScVal: jest.fn((value: string) => value),
  i128ToScVal: jest.fn((value: bigint) => value),
  stringToScVal: jest.fn((value: string) => value),
  u32ToScVal: jest.fn((value: number) => value),
  scValToNative: jest.fn(() => 42),
  buildUnsignedTransaction: jest.fn(),
  signTransaction: jest.fn(),
  simulateTransaction: jest.fn(),
  hashToScVal: jest.fn(),
}));

describe('bcForgeClient regression coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('awaits the submitted transaction before unwrapping its response', async () => {
    const mockedBuildInvokeTransaction = jest.mocked(utils.buildInvokeTransaction);
    const mockedSubmitTransaction = jest.mocked(utils.submitTransaction);
    const mockedScValToNative = jest.mocked(utils.scValToNative);

    mockedBuildInvokeTransaction.mockResolvedValueOnce('mock-xdr');
    mockedSubmitTransaction.mockResolvedValueOnce({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      hash: 'tx-hash',
      returnValue: xdr.ScVal.scvU32(7),
    } as unknown as Awaited<ReturnType<typeof utils.submitTransaction>>);

    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const result = await client.mint(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      100n,
      Keypair.random(),
    );

    expect(result).toEqual({
      success: true,
      hash: 'tx-hash',
      returnValue: 42,
    });
    expect(mockedSubmitTransaction).toHaveBeenCalledTimes(1);
    expect(mockedScValToNative).toHaveBeenCalledWith(expect.anything());
  });
});
