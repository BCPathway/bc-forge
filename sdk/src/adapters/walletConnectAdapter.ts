import { WalletAdapter } from '../walletAdapter';

/**
 * Minimal stub for WalletConnect-based signing. Concrete implementation
 * should be provided by consumers integrating WalletConnect + Stellar signing.
 */
export class WalletConnectAdapter implements WalletAdapter {
  name = 'walletconnect';
  connected = false;
  publicKey?: string;

  async connect(): Promise<void> {
    // WalletConnect integration is app-specific. Provide a stub that
    // instructs consumers to implement the actual flow.
    throw new Error('WalletConnectAdapter.connect() not implemented');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.publicKey = undefined;
  }

  async signTransaction(_unsignedTxXdr: string): Promise<string> {
    throw new Error('WalletConnectAdapter.signTransaction() not implemented');
  }
}

export default WalletConnectAdapter;
