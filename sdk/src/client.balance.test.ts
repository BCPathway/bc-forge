import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient } from './client';

describe('bcForgeClient balance formatting', () => {
  it('formats atomic balances using the token decimals', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const queryContract = jest.fn().mockImplementation(async (method: string) => {
      if (method === 'balance') {
        return nativeToScVal(12345678n, { type: 'i128' });
      }

      if (method === 'decimals') {
        return xdr.ScVal.scvU32(7);
      }

      throw new Error(`Unexpected method: ${method}`);
    });

    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    await expect(client.getBalance(Keypair.random().publicKey())).resolves.toBe('1.2345678');
    expect(queryContract).toHaveBeenCalledTimes(2);
    expect(queryContract.mock.calls[0][0]).toBe('balance');
    expect(queryContract.mock.calls[1][0]).toBe('decimals');
  });
});
