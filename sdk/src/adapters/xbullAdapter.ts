// SPDX-License-Identifier: MIT
import { WalletAdapter } from '../walletAdapter';

/**
 * Injected xBull SDK (`window.xBullSDK`, with `window.xBull` as a fallback).
 * Signing uses the documented `signXDR` method, then `signTransaction`.
 */
interface XBullInjectedApi {
  connect?: (permissions: {
    canRequestPublicKey: boolean;
    canRequestSign: boolean;
  }) => Promise<unknown>;
  getPublicKey?: () => Promise<unknown>;
  signXDR?: (unsignedTxXdr: string, options?: XBullSignOptions) => Promise<unknown>;
  signTransaction?: (unsignedTxXdr: string, options?: XBullSignOptions) => Promise<unknown>;
}

interface XBullSignOptions {
  network?: string;
  networkPassphrase?: string;
  publicKey?: string;
}

type BrowserScope = typeof globalThis & {
  xBullSDK?: XBullInjectedApi;
  xBull?: XBullInjectedApi;
};

function injectedXBull(): XBullInjectedApi | undefined {
  const scope = globalThis as BrowserScope;
  return scope.xBullSDK ?? scope.xBull;
}

function publicKeyFromResponse(response: unknown): string | undefined {
  if (typeof response === 'string') return response || undefined;
  if (!response || typeof response !== 'object') return undefined;
  const record = response as Record<string, unknown>;
  const key = record.publicKey ?? record.pubkey ?? record.public_key;
  return typeof key === 'string' && key ? key : undefined;
}

function networkPassphraseFromResponse(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const record = response as Record<string, unknown>;
  return typeof record.networkPassphrase === 'string' ? record.networkPassphrase : undefined;
}

function signedXdrFromResponse(response: unknown): string {
  if (!response) throw new Error('xBull failed to sign transaction');
  if (typeof response === 'string') return response;
  if (typeof response !== 'object') throw new Error('xBull did not return a signed transaction');

  const record = response as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error) {
    throw new Error(`xBull failed to sign transaction: ${record.error}`);
  }

  const signedXdr = record.signedXDR ?? record.signedTxXdr ?? record.signedXdr ?? record.xdr;
  if (typeof signedXdr !== 'string' || !signedXdr) {
    throw new Error('xBull did not return a signed transaction');
  }
  return signedXdr;
}

export class XBullAdapter implements WalletAdapter {
  name = 'xbull';
  connected = false;
  publicKey?: string;
  networkPassphrase?: string;

  async connect(): Promise<void> {
    const api = injectedXBull();
    if (!api) throw new Error('xBull API not available in this environment');

    if (typeof api.connect === 'function') {
      await api.connect({ canRequestPublicKey: true, canRequestSign: true });
    }

    const response = await api.getPublicKey?.();
    const publicKey = publicKeyFromResponse(response);
    if (!publicKey) throw new Error('xBull did not return a public key');

    this.publicKey = publicKey;
    this.networkPassphrase = networkPassphraseFromResponse(response);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.publicKey = undefined;
    this.networkPassphrase = undefined;
    this.connected = false;
  }

  async signTransaction(
    unsignedTxXdr: string,
    options?: { networkPassphrase?: string },
  ): Promise<string> {
    const api = injectedXBull();
    if (!api) throw new Error('xBull API not available in this environment');

    const sign = api.signXDR ?? api.signTransaction;
    if (typeof sign !== 'function') throw new Error('xBull cannot sign transactions');

    const network = options?.networkPassphrase ?? this.networkPassphrase;
    // xBull requires `network` and `publicKey` together when the second argument is set.
    const signingOptions: XBullSignOptions | undefined = network
      ? { network, networkPassphrase: network, publicKey: this.publicKey }
      : undefined;

    const response = await sign.call(api, unsignedTxXdr, signingOptions);
    return signedXdrFromResponse(response);
  }
}

export default XBullAdapter;
