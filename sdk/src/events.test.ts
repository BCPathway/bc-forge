// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Tests for the event data decoders and poll-based listeners (#924, #928)
 *
 * Pure unit tests; all inputs are plain tuples as produced by
 * `scValToNative` on Soroban event data.
 */

import { jest } from '@jest/globals';
import { xdr } from '@stellar/stellar-sdk';
import {
  EVENT_SCHEMA_VERSION,
  decodeMintEventData,
  decodeBurnEventData,
  decodeTransferEventData,
  decodeTransferFromEventData,
  decodeDepositEventData,
  decodeWithdrawEventData,
  onMint,
  onTransfer,
  onVaultDeposit,
} from './events';

describe('EVENT_SCHEMA_VERSION', () => {
  it('starts at schema version 1', () => {
    expect(EVENT_SCHEMA_VERSION).toBe(1);
  });
});

describe('decodeMintEventData', () => {
  it('decodes a versioned mint tuple', () => {
    const data = ['GADMIN', 'GTO', 1000, 2000, 5000, 1];
    expect(decodeMintEventData(data)).toEqual({
      version: 1,
      admin: 'GADMIN',
      to: 'GTO',
      amount: 1000,
      new_balance: 2000,
      new_supply: 5000,
    });
  });

  it('decodes a legacy mint tuple without a version as schema 0', () => {
    const data = ['GADMIN', 'GTO', 1000, 2000, 5000];
    expect(decodeMintEventData(data)).toMatchObject({ version: 0, to: 'GTO' });
  });

  it('returns null for tuples with an unexpected length', () => {
    expect(decodeMintEventData(['GADMIN', 'GTO'])).toBeNull();
    expect(decodeMintEventData([1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });

  it('returns null for non-array data', () => {
    expect(decodeMintEventData('nope')).toBeNull();
    expect(decodeMintEventData(undefined)).toBeNull();
  });
});

describe('decodeBurnEventData', () => {
  it('decodes a versioned burn tuple', () => {
    const data = ['GFROM', 300, 700, 10000, 1];
    expect(decodeBurnEventData(data)).toEqual({
      version: 1,
      from: 'GFROM',
      amount: 300,
      new_balance: 700,
      new_supply: 10000,
    });
  });

  it('decodes a legacy burn tuple as schema 0', () => {
    expect(decodeBurnEventData(['GFROM', 300, 700, 10000])).toMatchObject({
      version: 0,
      from: 'GFROM',
    });
  });

  it('returns null for invalid tuples', () => {
    expect(decodeBurnEventData(['GFROM'])).toBeNull();
    expect(decodeBurnEventData(42)).toBeNull();
  });
});

describe('decodeTransferEventData', () => {
  it('decodes a versioned xfer tuple', () => {
    const data = ['GFROM', 'GTO', 250, 1];
    expect(decodeTransferEventData(data)).toEqual({
      version: 1,
      from: 'GFROM',
      to: 'GTO',
      amount: 250,
    });
  });

  it('decodes a legacy xfer tuple as schema 0', () => {
    expect(decodeTransferEventData(['GFROM', 'GTO', 250])).toMatchObject({
      version: 0,
      amount: 250,
    });
  });

  it('returns null for invalid tuples', () => {
    expect(decodeTransferEventData([])).toBeNull();
    expect(decodeTransferEventData(['a', 'b'])).toBeNull();
  });
});

describe('decodeTransferFromEventData', () => {
  it('decodes a versioned xfer_frm tuple', () => {
    const data = ['GSPENDER', 'GFROM', 'GTO', 500, 150, 1];
    expect(decodeTransferFromEventData(data)).toEqual({
      version: 1,
      spender: 'GSPENDER',
      from: 'GFROM',
      to: 'GTO',
      amount: 500,
      remaining_allowance: 150,
    });
  });

  it('decodes a legacy xfer_frm tuple as schema 0', () => {
    const data = ['GSPENDER', 'GFROM', 'GTO', 500, 150];
    expect(decodeTransferFromEventData(data)).toMatchObject({ version: 0 });
  });

  it('returns null for invalid tuples', () => {
    expect(decodeTransferFromEventData(['a'])).toBeNull();
  });
});

describe('decodeDepositEventData', () => {
  it('decodes a versioned vault deposit tuple', () => {
    const data = ['GCALLER', 8000, 8000, 1];
    expect(decodeDepositEventData(data)).toEqual({
      version: 1,
      caller: 'GCALLER',
      assets: 8000,
      shares: 8000,
    });
  });

  it('decodes a legacy deposit tuple as schema 0', () => {
    expect(decodeDepositEventData(['GCALLER', 8000, 8000])).toMatchObject({
      version: 0,
      assets: 8000,
    });
  });

  it('returns null for invalid tuples', () => {
    expect(decodeDepositEventData(['GCALLER'])).toBeNull();
  });
});

describe('decodeWithdrawEventData', () => {
  it('decodes a versioned vault withdraw tuple', () => {
    const data = ['GCALLER', 4000, 3900, 1];
    expect(decodeWithdrawEventData(data)).toEqual({
      version: 1,
      caller: 'GCALLER',
      shares: 4000,
      underlying_amount: 3900,
    });
  });

  it('decodes a legacy withdraw tuple as schema 0', () => {
    expect(decodeWithdrawEventData(['GCALLER', 4000, 3900])).toMatchObject({
      version: 0,
      underlying_amount: 3900,
    });
  });

  it('returns null for invalid tuples', () => {
    expect(decodeWithdrawEventData(null)).toBeNull();
  });
});

describe('Poll-based listeners (#928)', () => {
  it('delivers one new event, ignores duplicate transaction hashes, and unsubscribe stops calls', async () => {
    const mintScValTopic = xdr.ScVal.scvSymbol('mint');
    const mintValueScVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvString('GADMIN'),
      xdr.ScVal.scvString('GTO'),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('100'), hi: xdr.Int64.fromString('0') })),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('100'), hi: xdr.Int64.fromString('0') })),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('100'), hi: xdr.Int64.fromString('0') })),
      xdr.ScVal.scvU32(1),
    ]);

    const mockEvents = [
      {
        id: 'tx_hash_1',
        txHash: 'tx_hash_1',
        ledger: 10,
        contractId: 'C123',
        topic: [mintScValTopic],
        value: mintValueScVal,
      },
    ];

    const mockServer = {
      getLatestLedger: jest.fn(async () => ({ sequence: 10 })),
      getEvents: jest.fn(async () => ({ events: mockEvents })),
    };

    const mintCallback = jest.fn();

    const unsub = await onMint('http://localhost', 'C123', mintCallback, {
      pollingIntervalMs: 50,
      startLedger: 10,
      server: mockServer as any,
    });

    await new Promise((r) => setTimeout(r, 120));

    expect(mintCallback).toHaveBeenCalledTimes(1);
    expect(mintCallback.mock.calls[0][1]).toMatchObject({
      admin: 'GADMIN',
      to: 'GTO',
    });

    // Same tx hash delivered again -> ignored
    await new Promise((r) => setTimeout(r, 120));
    expect(mintCallback).toHaveBeenCalledTimes(1);

    // Unsubscribe stops polling
    unsub();
    mintCallback.mockClear();
    await new Promise((r) => setTimeout(r, 150));
    expect(mintCallback).not.toHaveBeenCalled();
  });

  it('onTransfer delivers transfer events and ignores duplicates', async () => {
    const xferTopic = xdr.ScVal.scvSymbol('xfer');
    const xferVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvString('GFROM'),
      xdr.ScVal.scvString('GTO'),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('250'), hi: xdr.Int64.fromString('0') })),
      xdr.ScVal.scvU32(1),
    ]);

    const mockEvents = [
      {
        id: 'tx_transfer_1',
        txHash: 'tx_transfer_1',
        ledger: 10,
        contractId: 'C123',
        topic: [xferTopic],
        value: xferVal,
      },
    ];

    const mockServer = {
      getLatestLedger: jest.fn(async () => ({ sequence: 10 })),
      getEvents: jest.fn(async () => ({ events: mockEvents })),
    };

    const xferCallback = jest.fn();

    const unsub = await onTransfer('http://localhost', 'C123', xferCallback, {
      pollingIntervalMs: 50,
      startLedger: 10,
      server: mockServer as any,
    });

    await new Promise((r) => setTimeout(r, 120));
    expect(xferCallback).toHaveBeenCalledTimes(1);
    expect(xferCallback.mock.calls[0][1]).toMatchObject({
      from: 'GFROM',
      to: 'GTO',
      amount: 250n,
    });

    unsub();
  });

  it('onVaultDeposit delivers deposit events and ignores duplicates', async () => {
    const depositTopic = xdr.ScVal.scvSymbol('deposit');
    const depositVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvString('GCALLER'),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('500'), hi: xdr.Int64.fromString('0') })),
      xdr.ScVal.scvI128(new xdr.Int128Parts({ lo: xdr.Uint64.fromString('500'), hi: xdr.Int64.fromString('0') })),
      xdr.ScVal.scvU32(1),
    ]);

    const mockEvents = [
      {
        id: 'tx_deposit_1',
        txHash: 'tx_deposit_1',
        ledger: 10,
        contractId: 'C123',
        topic: [depositTopic],
        value: depositVal,
      },
    ];

    const mockServer = {
      getLatestLedger: jest.fn(async () => ({ sequence: 10 })),
      getEvents: jest.fn(async () => ({ events: mockEvents })),
    };

    const depositCallback = jest.fn();

    const unsub = await onVaultDeposit('http://localhost', 'C123', depositCallback, {
      pollingIntervalMs: 50,
      startLedger: 10,
      server: mockServer as any,
    });

    await new Promise((r) => setTimeout(r, 120));
    expect(depositCallback).toHaveBeenCalledTimes(1);
    expect(depositCallback.mock.calls[0][1]).toMatchObject({
      caller: 'GCALLER',
      assets: 500n,
    });

    unsub();
  });
});
