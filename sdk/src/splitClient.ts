// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — SplitClient
 *
 * Dedicated, strongly-typed TypeScript client for the `bc-forge-split`
 * Soroban contract. Supersedes the untyped `bcForgeClient.getSplitInvoice`
 * helper with a full set of read and write methods for batch payout,
 * revenue-sharing, and payroll-style invoices.
 */

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import type { WalletAdapter } from './walletAdapter';

import {
  buildInvokeTransaction,
  submitTransaction,
  addressToScVal,
  i128ToScVal,
  scValToNative,
  buildUnsignedTransaction,
  signTransaction,
  simulateTransaction,
} from './utils';

import { SimulationError, RPCError, SignerRequiredError } from './errors';
import type { TransactionResult } from './client';
import type { Signer } from './vestingClient';

export type { Signer };

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Recipient {
  to: string;
  amount: bigint;
}

export enum InvoiceStatus {
  Pending = 0,
  PartiallyReleased = 1,
  FullyReleased = 2,
  Failed = 3,
  Cancelled = 4,
}

export interface Invoice {
  invoiceId: bigint;
  creator?: string;
  totalAmount: bigint;
  releasedAmount: bigint;
  status: InvoiceStatus;
  recipients: Recipient[];
  createdAt: number;
}

export interface FailedPayout {
  invoiceId: bigint;
  recipient: string;
  amount: bigint;
  retryCount: number;
}

export interface SplitClientConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge-split contract ID */
  contractId: string;
  /** Optional wallet adapter for browser-based signing flows */
  walletAdapter?: WalletAdapter;
}

interface RawRecipient {
  to: string;
  amount: bigint;
}

interface RawInvoice {
  invoice_id: bigint;
  creator: string;
  total_amount: bigint;
  released_amount: bigint;
  status: string | { tag?: string };
  recipients: RawRecipient[];
  created_at: number;
}

interface RawFailedPayout {
  invoice_id: bigint;
  recipient: string;
  amount: bigint;
  retry_count: number;
}

const INVOICE_STATUS_BY_TAG: Record<string, InvoiceStatus> = {
  Pending: InvoiceStatus.Pending,
  PartiallyReleased: InvoiceStatus.PartiallyReleased,
  FullyReleased: InvoiceStatus.FullyReleased,
  Failed: InvoiceStatus.Failed,
  Cancelled: InvoiceStatus.Cancelled,
};

function toInvoiceStatus(raw: string | { tag?: string }): InvoiceStatus {
  const tag = typeof raw === 'string' ? raw : raw?.tag;
  const status = tag ? INVOICE_STATUS_BY_TAG[tag] : undefined;
  if (status === undefined) {
    throw new Error(`Unknown invoice status: ${JSON.stringify(raw)}`);
  }
  return status;
}

function toInvoice(raw: RawInvoice): Invoice {
  return {
    invoiceId: BigInt(raw.invoice_id),
    creator: raw.creator,
    totalAmount: BigInt(raw.total_amount),
    releasedAmount: BigInt(raw.released_amount),
    status: toInvoiceStatus(raw.status),
    recipients: raw.recipients.map((r) => ({ to: r.to, amount: BigInt(r.amount) })),
    createdAt: Number(raw.created_at),
  };
}

function toFailedPayout(raw: RawFailedPayout): FailedPayout {
  return {
    invoiceId: BigInt(raw.invoice_id),
    recipient: raw.recipient,
    amount: BigInt(raw.amount),
    retryCount: Number(raw.retry_count),
  };
}

function recipientsToScVal(recipients: Recipient[]): xdr.ScVal {
  return xdr.ScVal.scvVec(
    recipients.map(({ to, amount }) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('to'),
          val: addressToScVal(to),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: i128ToScVal(amount),
        }),
      ]),
    ),
  );
}

/**
 * Generates a locally-unique invoice id: a millisecond timestamp in the high
 * bits and 16 bits of random entropy in the low bits, comfortably within
 * `u64` range. The split contract takes invoice ids as caller-supplied
 * input rather than assigning them, so {@link SplitClient.createInvoice}
 * must mint one.
 */
function generateInvoiceId(): bigint {
  const timestamp = BigInt(Date.now());
  const entropy = BigInt(Math.floor(Math.random() * 0xffff));
  return (timestamp << 16n) | entropy;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class SplitClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;
  private walletAdapter?: WalletAdapter;

  constructor(config: SplitClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
    this.walletAdapter = config.walletAdapter;
  }

  /** Replace or set the wallet adapter at runtime. */
  setWalletAdapter(adapter?: WalletAdapter): void {
    this.walletAdapter = adapter;
  }

  /** The wallet adapter configured on this client, if any. */
  getWalletAdapter(): WalletAdapter | undefined {
    return this.walletAdapter;
  }

  // ─── Write Transactions ──────────────────────────────────────────────────

  /**
   * Create an invoice that pays out `recipients` from `token`. The invoice
   * total is the sum of recipient amounts; the caller must hold the admin
   * role on-chain. Returns the generated invoice id.
   */
  async createInvoice(recipients: Recipient[], token: string, signer?: Signer): Promise<bigint> {
    const adminAddress = await this.resolvePublicKey(signer);
    const invoiceId = generateInvoiceId();
    const totalAmount = recipients.reduce((sum, r) => sum + r.amount, 0n);

    await this.invokeContract(
      'create_invoice',
      [
        addressToScVal(adminAddress),
        nativeToScVal(invoiceId, { type: 'u64' }),
        i128ToScVal(totalAmount),
        recipientsToScVal(recipients),
        addressToScVal(token),
      ],
      signer,
    );

    return invoiceId;
  }

  /**
   * Release an invoice's payments to its recipients. Admin-only on-chain.
   */
  async releasePayment(invoiceId: bigint, signer?: Signer): Promise<TransactionResult> {
    const adminAddress = await this.resolvePublicKey(signer);
    return this.invokeContract(
      'release_payment',
      [nativeToScVal(invoiceId, { type: 'u64' }), addressToScVal(adminAddress)],
      signer,
    );
  }

  /**
   * Retry a previously failed payout to a single recipient. Admin-only on-chain.
   */
  async retryFailedPayout(
    invoiceId: bigint,
    recipient: string,
    signer?: Signer,
  ): Promise<TransactionResult> {
    const adminAddress = await this.resolvePublicKey(signer);
    return this.invokeContract(
      'retry_failed_payout',
      [
        nativeToScVal(invoiceId, { type: 'u64' }),
        addressToScVal(recipient),
        addressToScVal(adminAddress),
      ],
      signer,
    );
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  /**
   * Fetch an invoice by id.
   */
  async getInvoice(invoiceId: bigint): Promise<Invoice> {
    const result = await this.queryContract('get_invoice', [
      nativeToScVal(invoiceId, { type: 'u64' }),
    ]);
    return toInvoice(scValToNative(result) as RawInvoice);
  }

  /**
   * Fetch a failed payout record for a recipient on an invoice, or `null`
   * if none exists (i.e. the payout never failed or was already retried).
   */
  async getFailedPayout(invoiceId: bigint, recipient: string): Promise<FailedPayout | null> {
    try {
      const result = await this.queryContract('get_failed_payout', [
        nativeToScVal(invoiceId, { type: 'u64' }),
        addressToScVal(recipient),
      ]);
      return toFailedPayout(scValToNative(result) as RawFailedPayout);
    } catch (error) {
      if (error instanceof SimulationError && /FailedPayoutNotFound|#5/.test(error.message)) {
        return null;
      }
      throw error;
    }
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  private async resolvePublicKey(signer?: Signer): Promise<string> {
    if (!signer) {
      if (!this.walletAdapter?.publicKey) throw new SignerRequiredError();
      return this.walletAdapter.publicKey;
    }
    if (signer instanceof Keypair) return signer.publicKey();
    const adapter = signer as WalletAdapter;
    if (!adapter.publicKey) throw new SignerRequiredError('Wallet adapter is not connected');
    return adapter.publicKey;
  }

  private async withRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    throw lastError;
  }

  private async queryContract(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal> {
    return this.withRetry(async () => {
      try {
        const account = new (await import('@stellar/stellar-sdk')).Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        );

        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(this.contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const simulated = await this.server.simulateTransaction(tx);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new SimulationError(`Query failed: ${simulated.error}`, simulated.error);
        }

        if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
          throw new SimulationError('Query returned no result');
        }

        return simulated.result.retval;
      } catch (error: unknown) {
        if (error instanceof SimulationError) throw error;
        throw new RPCError('RPC call failed', error);
      }
    });
  }

  private async invokeContract(
    method: string,
    args: xdr.ScVal[],
    source?: Signer,
  ): Promise<TransactionResult> {
    const isAdapter = Boolean(source) && !(source instanceof Keypair);
    const adapter = isAdapter ? (source as WalletAdapter) : this.walletAdapter;
    const actualSource = isAdapter ? undefined : (source as Keypair | undefined);

    if (!actualSource && !adapter) throw new SignerRequiredError();
    if (!actualSource && (!adapter?.connected || !adapter.publicKey)) {
      throw new SignerRequiredError('Wallet adapter is not connected');
    }

    return this.withRetry(async () => {
      let txXdr: string;
      if (actualSource) {
        txXdr = await buildInvokeTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          actualSource,
        );
      } else {
        const unsignedXdr = await buildUnsignedTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          adapter!.publicKey!,
        );
        txXdr = await adapter!.signTransaction(unsignedXdr);
      }

      const response = await submitTransaction(this.rpcUrl, txXdr);

      if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          success: true,
          hash: (response as unknown as { hash?: string; txHash?: string }).hash ?? response.txHash,
          returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
        };
      }

      return {
        success: false,
        hash: (response as unknown as { hash?: string; txHash?: string }).hash ?? response.txHash,
      };
    });
  }

  /**
   * Simulate a contract call without submitting a transaction.
   */
  async simulate(method: string, args: xdr.ScVal[], sourcePublicKey: string): Promise<unknown> {
    return simulateTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      method,
      args,
      sourcePublicKey,
    );
  }

  /**
   * Sign an unsigned transaction XDR with a Keypair.
   */
  signTx(xdrString: string, signer: Keypair): string {
    return signTransaction(xdrString, this.networkPassphrase, signer);
  }
}
