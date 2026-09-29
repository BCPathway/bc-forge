// SPDX-License-Identifier: MIT
import { WalletAdapter } from '../walletAdapter';

interface FreighterNetworkDetails {
  networkPassphrase?: string;
  network?: string;
  error?: string;
  networkDetails?: FreighterNetworkDetails;
}

function networkPassphraseFromNetwork(network: string | undefined): string | undefined {
  switch (network?.toLowerCase()) {
    case 'public':
    case 'mainnet':
      return 'Public Global Stellar Network ; September 2015';
    case 'testnet':
      return 'Test SDF Network ; September 2015';
    default:
      return undefined;
  }
}

export class FreighterAdapter implements WalletAdapter {
  name = 'freighter';
  connected = false;
  publicKey?: string;
  networkPassphrase?: string;

  async connect(): Promise<void> {
    const api = (globalThis as any).freighter;
    if (!api) throw new Error('Freighter API not available in this environment');
    const publicKey = await api.getPublicKey?.();
    if (!publicKey) throw new Error('Freighter did not return a public key');

    this.publicKey = publicKey;
    this.networkPassphrase = await this.readNetworkPassphrase(api);
    this.connected = true;
  }

  private async readNetworkPassphrase(api: any): Promise<string | undefined> {
    const getDetails = api.getNetworkDetails ?? api.getNetwork;
    if (typeof getDetails !== 'function') return undefined;

    const response = (await getDetails.call(api)) as FreighterNetworkDetails | undefined;
    const details = response?.networkDetails ?? response;
    if (details?.error) throw new Error(`Freighter could not report its network: ${details.error}`);

    return details?.networkPassphrase ?? networkPassphraseFromNetwork(details?.network);
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
    const api = (globalThis as any).freighter;
    if (!api) throw new Error('Freighter API not available in this environment');
    const response = await api.signTransaction(unsignedTxXdr, {
      networkPassphrase: options?.networkPassphrase,
    });
    if (!response) throw new Error('Freighter failed to sign transaction');
    if (response.error) throw new Error(`Freighter failed to sign transaction: ${response.error}`);

    if (typeof response === 'string') return response;
    const signedXdr = response.signedTxXdr ?? response.signedXdr ?? response.xdr;
    if (!signedXdr) throw new Error('Freighter did not return a signed transaction');
    return signedXdr;
  }
}

export default FreighterAdapter;
