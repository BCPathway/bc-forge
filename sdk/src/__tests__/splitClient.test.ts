// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { SplitClient, InvoiceStatus, type Recipient } from '../splitClient';
import { SimulationError } from '../errors';
import { addressToScVal, i128ToScVal, u32ToScVal } from '../utils';

const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_PASSPHRASE = 'Test SDF Network ; September 2015';

function structScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

function recipientScVal(recipient: Recipient): xdr.ScVal {
  return structScVal({
    to: addressToScVal(recipient.to),
    amount: i128ToScVal(recipient.amount),
  });
}

function u64ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'u64' });
}

function invoiceScVal(invoice: {
  invoiceId: bigint;
  creator: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  status: string;
  recipients: Recipient[];
  createdAt: number;
}): xdr.ScVal {
  return structScVal({
    invoice_id: u64ScVal(invoice.invoiceId),
    creator: addressToScVal(invoice.creator),
    total_amount: i128ToScVal(invoice.totalAmount),
    released_amount: i128ToScVal(invoice.releasedAmount),
    status: xdr.ScVal.scvSymbol(invoice.status),
    recipients: xdr.ScVal.scvVec(invoice.recipients.map(recipientScVal)),
    created_at: u32ToScVal(invoice.createdAt),
  });
}

function failedPayoutScVal(payout: {
  invoiceId: bigint;
  recipient: string;
  amount: bigint;
  retryCount: number;
}): xdr.ScVal {
  return structScVal({
    invoice_id: u64ScVal(payout.invoiceId),
    recipient: addressToScVal(payout.recipient),
    amount: i128ToScVal(payout.amount),
    retry_count: u32ToScVal(payout.retryCount),
  });
}

describe('SplitClient surface', () => {
  let client: SplitClient;

  beforeEach(() => {
    client = new SplitClient({
      rpcUrl: MOCK_RPC_URL,
      networkPassphrase: MOCK_PASSPHRASE,
      contractId: MOCK_CONTRACT_ID,
    });
  });

  it('exposes all required methods', () => {
    expect(typeof client.createInvoice).toBe('function');
    expect(typeof client.releasePayment).toBe('function');
    expect(typeof client.retryFailedPayout).toBe('function');
    expect(typeof client.getInvoice).toBe('function');
    expect(typeof client.getFailedPayout).toBe('function');
  });

  it('creates an invoice, aggregating recipient amounts into the total', async () => {
    const invokeContract = jest.fn(async () => ({ success: true, hash: 'mock-hash' }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    const recipients: Recipient[] = [
      { to: Keypair.random().publicKey(), amount: 600n },
      { to: Keypair.random().publicKey(), amount: 400n },
    ];
    const token = Keypair.random().publicKey();

    const invoiceId = await client.createInvoice(recipients, token, source);

    expect(typeof invoiceId).toBe('bigint');
    expect(invokeContract).toHaveBeenCalledWith('create_invoice', expect.any(Array), source);
  });

  it('releases a payment with the admin signer resolved from the Keypair', async () => {
    const invokeContract = jest.fn(async () => ({ success: true, hash: 'mock-hash' }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    await client.releasePayment(42n, source);

    expect(invokeContract).toHaveBeenCalledWith('release_payment', expect.any(Array), source);
  });

  it('retries a failed payout', async () => {
    const invokeContract = jest.fn(async () => ({ success: true, hash: 'mock-hash' }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    const recipient = Keypair.random().publicKey();
    await client.retryFailedPayout(42n, recipient, source);

    expect(invokeContract).toHaveBeenCalledWith('retry_failed_payout', expect.any(Array), source);
  });

  it('decodes get_invoice into a typed Invoice, mapping the status symbol', async () => {
    const creator = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();
    const queryContract = jest.fn(async () =>
      invoiceScVal({
        invoiceId: 42n,
        creator,
        totalAmount: 1000n,
        releasedAmount: 400n,
        status: 'PartiallyReleased',
        recipients: [{ to: recipient, amount: 1000n }],
        createdAt: 123,
      }),
    );
    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    const invoice = await client.getInvoice(42n);

    expect(queryContract).toHaveBeenCalledWith('get_invoice', expect.any(Array));
    expect(invoice).toEqual({
      invoiceId: 42n,
      creator,
      totalAmount: 1000n,
      releasedAmount: 400n,
      status: InvoiceStatus.PartiallyReleased,
      recipients: [{ to: recipient, amount: 1000n }],
      createdAt: 123,
    });
  });

  it('decodes get_failed_payout into a typed FailedPayout', async () => {
    const recipient = Keypair.random().publicKey();
    const queryContract = jest.fn(async () =>
      failedPayoutScVal({ invoiceId: 42n, recipient, amount: 250n, retryCount: 2 }),
    );
    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    const payout = await client.getFailedPayout(42n, recipient);

    expect(payout).toEqual({ invoiceId: 42n, recipient, amount: 250n, retryCount: 2 });
  });

  it('returns null from getFailedPayout when the contract reports FailedPayoutNotFound', async () => {
    const queryContract = jest.fn(async () => {
      throw new SimulationError('Query failed: FailedPayoutNotFound', 'FailedPayoutNotFound');
    });
    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    const payout = await client.getFailedPayout(42n, Keypair.random().publicKey());
    expect(payout).toBeNull();
  });

  it('propagates unrelated simulation errors from getFailedPayout', async () => {
    const queryContract = jest.fn(async () => {
      throw new SimulationError('Query failed: something else went wrong');
    });
    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    await expect(client.getFailedPayout(42n, Keypair.random().publicKey())).rejects.toThrow(
      SimulationError,
    );
  });
});
