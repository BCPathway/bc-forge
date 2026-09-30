// SPDX-License-Identifier: MIT
import { Keypair, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { WalletAdapter } from '../walletAdapter';

/**
 * Secret material comes only from the caller: a `secretKey` argument, or the
 * value of an environment variable whose name the caller supplies via `envVar`.
 * This adapter never reads a default path or a built-in variable name.
 */
export interface PrivateKeyAdapterOptions {
  secretKey?: string;
  envVar?: string;
  networkPassphrase?: string;
}

function secretFromCaller(options: PrivateKeyAdapterOptions): string {
  if (typeof options.secretKey === 'string' && options.secretKey.length > 0) {
    return options.secretKey;
  }

  if (typeof options.envVar === 'string' && options.envVar.length > 0) {
    const value = typeof process !== 'undefined' ? process.env[options.envVar] : undefined;
    if (!value) {
      throw new Error(`PrivateKeyAdapter: environment variable "${options.envVar}" is not set`);
    }
    return value;
  }

  throw new Error('PrivateKeyAdapter requires secretKey or envVar supplied by the caller');
}

export class PrivateKeyAdapter implements WalletAdapter {
  name = 'private-key';
  connected = false;
  publicKey?: string;
  networkPassphrase?: string;

  private readonly keypair: Keypair;

  constructor(options: PrivateKeyAdapterOptions) {
    this.keypair = Keypair.fromSecret(secretFromCaller(options));
    this.networkPassphrase = options.networkPassphrase;
  }

  async connect(): Promise<void> {
    this.publicKey = this.keypair.publicKey();
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.publicKey = undefined;
    this.connected = false;
  }

  async signTransaction(
    unsignedTxXdr: string,
    options?: { networkPassphrase?: string },
  ): Promise<string> {
    const networkPassphrase = options?.networkPassphrase ?? this.networkPassphrase;
    if (!networkPassphrase) {
      throw new Error('PrivateKeyAdapter requires a network passphrase to sign');
    }

    const tx = TransactionBuilder.fromXDR(unsignedTxXdr, networkPassphrase);
    const signature = this.keypair.sign(tx.hash());
    tx.addDecoratedSignature(
      new xdr.DecoratedSignature({
        hint: this.keypair.signatureHint(),
        signature,
      }),
    );
    return tx.toXDR();
  }
}

export default PrivateKeyAdapter;
