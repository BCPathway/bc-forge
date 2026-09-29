import { jest } from '@jest/globals';
import { rpc as SorobanRpc, StrKey } from '@stellar/stellar-sdk';

jest.unstable_mockModule('./utils', () => ({
  buildInvokeTransaction: jest.fn(),
  submitTransaction: jest.fn(),
  addressToScVal: jest.fn((value: string) => value),
  i128ToScVal: jest.fn((value: bigint) => value),
  u32ToScVal: jest.fn((value: number) => value),
  scValToNative: jest.fn(() => 42),
  buildUnsignedTransaction: jest.fn(),
  signTransaction: jest.fn(),
  simulateTransaction: jest.fn(),
}));

let utils: typeof import('./utils');
let VaultClient: typeof import('./vaultClient').VaultClient;
const MOCK_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

describe('VaultClient wallet adapter signing', () => {
  beforeAll(async () => {
    utils = await import('./utils');
    ({ VaultClient } = await import('./vaultClient'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('signs and submits a deposit with the configured wallet adapter', async () => {
    const buildUnsigned = jest.mocked(utils.buildUnsignedTransaction);
    const submit = jest.mocked(utils.submitTransaction);
    buildUnsigned.mockResolvedValueOnce('unsigned-xdr');
    submit.mockResolvedValueOnce({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      txHash: 'deposit-hash',
    } as unknown as Awaited<ReturnType<typeof utils.submitTransaction>>);

    const adapter = {
      name: 'test-wallet',
      connected: true,
      publicKey: 'GOWNER',
      connect: jest.fn(async () => {}),
      disconnect: jest.fn(async () => {}),
      signTransaction: jest.fn(async () => 'signed-xdr'),
    };
    const client = new VaultClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: MOCK_CONTRACT_ID,
    });
    client.setWalletAdapter(adapter);

    await expect(client.deposit('GOWNER', 25n)).resolves.toEqual({
      success: true,
      hash: 'deposit-hash',
      returnValue: undefined,
    });
    expect(buildUnsigned).toHaveBeenCalledWith(
      'https://soroban-testnet.stellar.org',
      'Test SDF Network ; September 2015',
      MOCK_CONTRACT_ID,
      'deposit',
      expect.any(Array),
      'GOWNER',
    );
    expect(adapter.signTransaction).toHaveBeenCalledWith('unsigned-xdr');
    expect(submit).toHaveBeenCalledWith('https://soroban-testnet.stellar.org', 'signed-xdr');
  });

  it('rejects deposits without an explicit signer or configured adapter', async () => {
    const client = new VaultClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: MOCK_CONTRACT_ID,
    });

    await expect(client.deposit('GOWNER', 25n)).rejects.toThrow(
      'A signer (Keypair or connected WalletAdapter) is required',
    );
  });
});