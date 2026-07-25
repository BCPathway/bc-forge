import { WalletAdapter } from '../walletAdapter';

export class FreighterAdapter implements WalletAdapter {
  name = 'freighter';
  connected = false;
  publicKey?: string;

  async connect(): Promise<void> {
    const api = (globalThis as any).freighter;
    if (!api) throw new Error('Freighter API not available in this environment');
    const pk = await api.getPublicKey?.();
    if (!pk) throw new Error('Freighter did not return a public key');
    this.publicKey = pk;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.publicKey = undefined;
    this.connected = false;
  }

  async signTransaction(unsignedTxXdr: string): Promise<string> {
    const api = (globalThis as any).freighter;
    if (!api) throw new Error('Freighter API not available in this environment');
    const resp = await api.signTransaction(unsignedTxXdr);
    if (!resp) throw new Error('Freighter failed to sign transaction');
    // Freighter returns an object in some versions; try to read xdr or raw
    return resp.xdr || resp.signedXdr || resp;
  }
}

export default FreighterAdapter;
