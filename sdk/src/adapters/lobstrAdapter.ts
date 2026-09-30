// SPDX-License-Identifier: MIT
import { WalletAdapter } from '../walletAdapter';

/**
 * Globals documented by @lobstrco/signer-extension-api, plus the `lobstrApi`
 * name some hosts inject. The SDK calls whichever is present.
 */
interface LobstrInjectedApi {
  isConnected?: () => Promise<boolean | { isConnected?: boolean }>;
  getPublicKey?: () => Promise<unknown>;
  signTransaction?: (
    unsignedTxXdr: string,
    options?: { networkPassphrase?: string },
  ) => Promise<unknown>;
}

type BrowserScope = typeof globalThis & {
  lobstrSignerExtensionApi?: LobstrInjectedApi;
  lobstrApi?: LobstrInjectedApi;
  lobstrSignerExtension?: LobstrInjectedApi;
};

function injectedLobstr(): LobstrInjectedApi | undefined {
  const scope = globalThis as BrowserScope;
  return scope.lobstrSignerExtensionApi ?? scope.lobstrApi ?? scope.lobstrSignerExtension;
}

function publicKeyFromResponse(response: unknown): string | undefined {
  if (typeof response === 'string') return response || undefined;
  if (!response || typeof response !== 'object') return undefined;
  const record = response as Record<string, unknown>;
  const key = record.publicKey ?? record.pubkey ?? record.public_key;
  return typeof key === 'string' && key ? key : undefined;
}

function signedXdrFromResponse(response: unknown): string {
  if (!response) throw new Error('Lobstr failed to sign transaction');
  if (typeof response === 'string') return response;
  if (typeof response !== 'object') throw new Error('Lobstr did not return a signed transaction');

  const record = response as Record<string, unknown>;
  if (typeof record.error === 'string' && record.error) {
    throw new Error(`Lobstr failed to sign transaction: ${record.error}`);
  }

  const signedXdr = record.signedTxXdr ?? record.signedXdr ?? record.signedXDR ?? record.xdr;
  if (typeof signedXdr !== 'string' || !signedXdr) {
    throw new Error('Lobstr did not return a signed transaction');
  }
  return signedXdr;
}

export class LobstrAdapter implements WalletAdapter {
  name = 'lobstr';
  connected = false;
  publicKey?: string;
  networkPassphrase?: string;

  async connect(): Promise<void> {
    const api = injectedLobstr();
    if (!api) throw new Error('Lobstr API not available in this environment');

    if (typeof api.isConnected === 'function') {
      const status = await api.isConnected();
      const available = typeof status === 'boolean' ? status : status?.isConnected;
      if (available === false) throw new Error('Lobstr is not connected');
    }

    const publicKey = publicKeyFromResponse(await api.getPublicKey?.());
    if (!publicKey) throw new Error('Lobstr did not return a public key');

    this.publicKey = publicKey;
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
    const api = injectedLobstr();
    if (!api?.signTransaction) throw new Error('Lobstr API not available in this environment');

    const networkPassphrase = options?.networkPassphrase ?? this.networkPassphrase;
    const response = await api.signTransaction(
      unsignedTxXdr,
      networkPassphrase ? { networkPassphrase } : undefined,
    );
    return signedXdrFromResponse(response);
  }
}

export default LobstrAdapter;
