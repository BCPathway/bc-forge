import { jest } from '@jest/globals';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient } from './client';

describe('bcForgeClient balance formatting', () => {
  it('formats atomic balances using the token decimals', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const queryContract = jest.fn(async (...args: unknown[]) => {
      const method = args[0] as string;
      if (method === 'balance') {
        return nativeToScVal(12345678n, { type: 'i128' });
      }

      if (method === 'decimals') {
        return xdr.ScVal.scvU32(7);
      }

      throw new Error(`Unexpected method: ${method}`);
    });

    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    await expect(client.getBalance(Keypair.random().publicKey())).resolves.toBe(12345678n);
    expect(queryContract).toHaveBeenCalledTimes(1);
    expect(queryContract.mock.calls[0][0]).toBe('balance');
  });
});
