import { WalletAdapter } from '../walletAdapter';

export class AlbedoAdapter implements WalletAdapter {
  name = 'albedo';
  connected = false;
  publicKey?: string;

  async connect(): Promise<void> {
    const albedo = (globalThis as any).albedo;
    if (!albedo) throw new Error('Albedo not available in this environment');
    const resp = await albedo.publicKey();
    if (!resp) throw new Error('Albedo did not return a public key');
    this.publicKey = resp;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.publicKey = undefined;
    this.connected = false;
  }

  async signTransaction(unsignedTxXdr: string): Promise<string> {
    const albedo = (globalThis as any).albedo;
    if (!albedo) throw new Error('Albedo not available in this environment');
    // Albedo's signing interface varies; attempt common patterns
    const signed = await albedo.signTransaction?.(unsignedTxXdr) || (await albedo.signTx?.(unsignedTxXdr));
    if (!signed) throw new Error('Albedo failed to sign transaction');
    return signed.xdr || signed;
  }
}

export default AlbedoAdapter;
