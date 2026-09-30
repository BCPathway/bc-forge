// SPDX-License-Identifier: MIT
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

describe('bcForgeClient ledger-keyed cache (#931)', () => {
  it('repeated getBalance and allowance reads in one ledger hit RPC once', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const queryContract = jest.fn(async (...args: unknown[]) => {
      const method = args[0] as string;
      if (method === 'balance') return nativeToScVal(1000n, { type: 'i128' });
      if (method === 'allowance') return nativeToScVal(500n, { type: 'i128' });
      throw new Error(`Unexpected method: ${method}`);
    });

    (client as any).queryContract = queryContract;
    client.setLedgerSequence(100);

    const addr = Keypair.random().publicKey();
    const spender = Keypair.random().publicKey();

    // First read -> hits queryContract
    const b1 = await client.getBalance(addr);
    expect(b1).toBe(1000n);
    expect(queryContract).toHaveBeenCalledTimes(1);

    // Second read at same ledger -> hits cache, queryContract not called again
    const b2 = await client.getBalance(addr);
    expect(b2).toBe(1000n);
    expect(queryContract).toHaveBeenCalledTimes(1);

    // Allowance read -> hits queryContract
    const a1 = await client.getAllowance(addr, spender);
    expect(a1).toBe(500n);
    expect(queryContract).toHaveBeenCalledTimes(2);

    // Second allowance read -> hits cache
    const a2 = await client.getAllowance(addr, spender);
    expect(a2).toBe(500n);
    expect(queryContract).toHaveBeenCalledTimes(2);
  });

  it('a new ledger sequence calls RPC again', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const queryContract = jest.fn(async (...args: unknown[]) => {
      return nativeToScVal(1000n, { type: 'i128' });
    });

    (client as any).queryContract = queryContract;
    const addr = Keypair.random().publicKey();

    client.setLedgerSequence(100);
    await client.getBalance(addr);
    expect(queryContract).toHaveBeenCalledTimes(1);

    // Advance ledger to 101
    client.setLedgerSequence(101);
    await client.getBalance(addr);
    expect(queryContract).toHaveBeenCalledTimes(2);
  });

  it('a successful write invalidates the cache', async () => {
    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const queryContract = jest.fn(async (...args: unknown[]) => {
      return nativeToScVal(1000n, { type: 'i128' });
    });

    (client as any).queryContract = queryContract;
    client.setLedgerSequence(100);

    const addr = Keypair.random().publicKey();
    await client.getBalance(addr);
    expect(queryContract).toHaveBeenCalledTimes(1);

    // Perform write method (clearCache)
    client.clearCache();

    // Next read calls queryContract again
    await client.getBalance(addr);
    expect(queryContract).toHaveBeenCalledTimes(2);
  });
});
