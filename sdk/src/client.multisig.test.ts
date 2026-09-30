// SPDX-License-Identifier: MIT
/**
 * Admin multisig helpers call the real contract entry points:
 * create_proposal, approve_proposal, and execute_upgrade.
 */

import { jest } from '@jest/globals';
import { Keypair, Networks, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient } from './client';
import { addressToScVal, hashToScVal, stringToScVal } from './utils';

const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const WASM_HASH = 'ab'.repeat(32);

describe('bcForgeClient admin multisig', () => {
  const source = Keypair.random();
  const client = new bcForgeClient({
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: Networks.TESTNET,
    contractId: MOCK_CONTRACT_ID,
  });

  function stubInvoke() {
    const invokeContract = jest.fn(
      async (_method: string, _args: xdr.ScVal[], _source: Keypair) => ({
        success: true,
        hash: 'mock-hash',
        returnValue: 4n,
      }),
    );
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract = invokeContract;
    return invokeContract;
  }

  it('createProposal calls create_proposal', async () => {
    const invokeContract = stubInvoke();
    const creator = source.publicKey();

    const result = await client.createProposal(creator, 'Upgrade to v2.1.0', source);

    expect(result.returnValue).toBe(4n);
    expect(invokeContract).toHaveBeenCalledTimes(1);
    const [method, args, signer] = invokeContract.mock.calls[0] as unknown as [
      string,
      xdr.ScVal[],
      Keypair,
    ];
    expect(method).toBe('create_proposal');
    expect(signer).toBe(source);
    expect(args[0].toXDR('base64')).toBe(addressToScVal(creator).toXDR('base64'));
    expect(args[1].toXDR('base64')).toBe(stringToScVal('Upgrade to v2.1.0').toXDR('base64'));
  });

  it('approveProposal calls approve_proposal', async () => {
    const invokeContract = stubInvoke();
    const admin = source.publicKey();

    await client.approveProposal(admin, 8n, source);

    const [method, args] = invokeContract.mock.calls[0] as unknown as [string, xdr.ScVal[]];
    expect(method).toBe('approve_proposal');
    expect(args[0].toXDR('base64')).toBe(addressToScVal(admin).toXDR('base64'));
    expect(args[1].toXDR('base64')).toBe(nativeToScVal(8n, { type: 'u64' }).toXDR('base64'));
  });

  it('executeUpgrade calls execute_upgrade', async () => {
    const invokeContract = stubInvoke();
    const executor = source.publicKey();

    await client.executeUpgrade(executor, 8n, WASM_HASH, source);

    const [method, args] = invokeContract.mock.calls[0] as unknown as [string, xdr.ScVal[]];
    expect(method).toBe('execute_upgrade');
    expect(args).toHaveLength(3);
    expect(args[0].toXDR('base64')).toBe(addressToScVal(executor).toXDR('base64'));
    expect(args[1].toXDR('base64')).toBe(nativeToScVal(8n, { type: 'u64' }).toXDR('base64'));
    expect(args[2].toXDR('base64')).toBe(hashToScVal(WASM_HASH).toXDR('base64'));
  });

  it('execute submits the signed XDR and does not build a new invocation', async () => {
    const invokeContract = stubInvoke();
    const submitSignedTransaction = jest.fn(async (txXdr: string) => ({
      success: true,
      hash: 'submitted-hash',
    }));
    (client as unknown as { submitSignedTransaction: typeof submitSignedTransaction }).submitSignedTransaction =
      submitSignedTransaction;

    const result = await client.execute('SIGNED_EXECUTE_XDR');

    expect(result.hash).toBe('submitted-hash');
    expect(submitSignedTransaction).toHaveBeenCalledWith('SIGNED_EXECUTE_XDR');
    expect(invokeContract).not.toHaveBeenCalled();
  });
});
