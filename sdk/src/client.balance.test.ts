import { jest } from '@jest/globals';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient, Role } from './client';
import { SignerRequiredError } from './errors';

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

describe('bcForgeClient read-only mode', () => {
  it('allows reading balances and contract details without a wallet or signer', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const queryContract = jest.fn(async (...args: unknown[]) => {
      const method = args[0] as string;
      if (method === 'balance') {
        return nativeToScVal(5000000n, { type: 'i128' });
      }
      if (method === 'name') {
        return nativeToScVal('TestToken');
      }
      if (method === 'symbol') {
        return nativeToScVal('TST');
      }
      if (method === 'supply') {
        return nativeToScVal(100000000n, { type: 'i128' });
      }
      throw new Error(`Unexpected method: ${method}`);
    });

    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    const testAddr = Keypair.random().publicKey();
    await expect(client.getBalance(testAddr)).resolves.toBe(5000000n);
    await expect(client.getName()).resolves.toBe('TestToken');
    await expect(client.getSymbol()).resolves.toBe('TST');
    await expect(client.getTotalSupply()).resolves.toBe(100000000n);
  });

  it('fails write operations with a typed SignerRequiredError when constructed without a wallet', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const targetAddr = Keypair.random().publicKey();

    await expect(client.mint(targetAddr, 100n)).rejects.toThrow(SignerRequiredError);
    await expect(client.transfer(targetAddr, Keypair.random().publicKey(), 50n)).rejects.toThrow(SignerRequiredError);
    await expect(client.burn(targetAddr, 10n)).rejects.toThrow(SignerRequiredError);
    await expect(client.pause()).rejects.toThrow(SignerRequiredError);
    await expect(client.unpause()).rejects.toThrow(SignerRequiredError);
    await expect(client.grantRole(Role.Minter, targetAddr)).rejects.toThrow(SignerRequiredError);
    await expect(client.revokeRole(Role.Minter, targetAddr)).rejects.toThrow(SignerRequiredError);
  });
});

