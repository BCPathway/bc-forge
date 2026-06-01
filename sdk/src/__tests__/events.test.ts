// @bc-forge/sdk — Event parsing tests

import { decodeEvent, bcForgeEventType } from '../events';
import { xdr } from '@stellar/stellar-sdk';

test('decodeEvent parses versioned schema correctly', () => {
  const mockEvent = {
    topic: [
      xdr.ScVal.scvString('BcForge'), // contract symbol
      xdr.ScVal.scvString(bcForgeEventType.MINT), // event name
      xdr.ScVal.scvU32(1), // version
      xdr.ScVal.scvU64(12345), // ledgerSeq
      xdr.ScVal.scvU64(1670000000), // timestamp
      xdr.ScVal.scvString('txhash123'), // txHash
    ],
    value: xdr.ScVal.scvU64(1000), // payload
    ledger: 12345,
    contractId: 'abcdef',
  } as any;

  const decoded = decodeEvent(mockEvent);
  expect(decoded).not.toBeNull();
  if (decoded) {
    expect(decoded.header.contractSymbol).toBe('BcForge');
    expect(decoded.header.eventName).toBe(bcForgeEventType.MINT);
    expect(decoded.header.version).toBe(1);
    expect(decoded.header.ledgerSeq).toBe(12345);
    expect(decoded.header.timestamp).toBe(1670000000);
    expect(decoded.header.txHash).toBe('txhash123');
    expect(decoded.payload).toBe(1000);
  }
});
