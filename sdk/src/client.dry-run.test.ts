// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Keypair, rpc as SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient } from './client';

function mintDiagnosticEvent(): xdr.DiagnosticEvent {
  const body = new xdr.ContractEventBody(
    0,
    new xdr.ContractEventV0({
      topics: [xdr.ScVal.scvSymbol('mint')],
      data: xdr.ScVal.scvVec([xdr.ScVal.scvString('GTO')]),
    }),
  );
  const event = new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: null,
    type: xdr.ContractEventType.contract(),
    body,
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: true, event });
}

describe('bcForgeClient.dryRun', () => {
  const sourcePublicKey = Keypair.random().publicKey();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns fee, footprint, and one decoded event without submitting', async () => {
    const readOnly = [{ key: 'read-only' }];
    const readWrite = [{ key: 'read-write' }];
    const simulated = {
      minResourceFee: '4242',
      transactionData: {
        getFootprint: () => ({
          readOnly: () => readOnly,
          readWrite: () => readWrite,
        }),
      },
      events: [mintDiagnosticEvent()],
    };

    const simulate = jest
      .spyOn(SorobanRpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue(simulated as never);
    const send = jest.spyOn(SorobanRpc.Server.prototype, 'sendTransaction');

    const client = new bcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
    });

    const result = await client.dryRun('mint', [], sourcePublicKey);

    expect(result.fee).toBe('4242');
    expect(result.footprint).toEqual({ readOnly, readWrite });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: 'mint',
      ledger: 0,
      data: ['GTO'],
    });
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
