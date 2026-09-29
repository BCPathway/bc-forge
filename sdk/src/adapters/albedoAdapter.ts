import { WalletAdapter } from '../walletAdapter';

interface AlbedoPublicKeyResponse {
  pubkey?: string;
  publicKey?: string;
  network?: string;
  networkPassphrase?: string;
}

function networkPassphraseFromNetwork(network: string | undefined): string | undefined {
  switch (network?.toLowerCase()) {
    case 'public':
    case 'mainnet':
      return 'Public Global Stellar Network ; September 2015';
    case 'testnet':
      return 'Test SDF Network ; September 2015';
    default:
      // Albedo also accepts private network passphrases in its `network` field.
      return network?.includes(';') ? network : undefined;
  }
}

export class AlbedoAdapter implements WalletAdapter {
  name = 'albedo';
  connected = false;
  publicKey?: string;
  networkPassphrase?: string;

  async connect(): Promise<void> {
    const albedo = (globalThis as any).albedo;
    if (!albedo) throw new Error('Albedo not available in this environment');
    const response = (await albedo.publicKey()) as string | AlbedoPublicKeyResponse | undefined;
    const publicKey =
      typeof response === 'string' ? response : response?.pubkey ?? response?.publicKey;
    if (!publicKey) throw new Error('Albedo did not return a public key');

    this.publicKey = publicKey;
    this.networkPassphrase =
      typeof response === 'string'
        ? undefined
        : response?.networkPassphrase ?? networkPassphraseFromNetwork(response?.network);
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
    const albedo = (globalThis as any).albedo;
    if (!albedo) throw new Error('Albedo not available in this environment');
    const network = options?.networkPassphrase ?? this.networkPassphrase;
    const signingOptions = network ? { network } : undefined;

    const response =
      (await albedo.signTransaction?.(unsignedTxXdr, signingOptions)) ||
      (await albedo.signTx?.(unsignedTxXdr, signingOptions)) ||
      (await albedo.tx?.({ xdr: unsignedTxXdr, ...signingOptions }));
    if (!response) throw new Error('Albedo failed to sign transaction');
    if (response.error) throw new Error(`Albedo failed to sign transaction: ${response.error}`);
    if (typeof response === 'string') return response;

    const signedXdr =
      response.signed_envelope_xdr ?? response.signedTxXdr ?? response.signedXdr ?? response.xdr;
    if (!signedXdr) throw new Error('Albedo did not return a signed transaction');
    return signedXdr;
  }
}

export default AlbedoAdapter;
