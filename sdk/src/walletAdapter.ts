export interface WalletAdapter {
  /** Human readable adapter name */
  name: string;
  /** Whether the wallet is currently connected */
  connected: boolean;
  /** Connected wallet public key (G... address) if connected */
  publicKey?: string;

  /** Connect to the wallet (popups, permissions, etc) */
  connect(): Promise<void>;
  /** Disconnect from the wallet */
  disconnect(): Promise<void>;
  /** Sign an unsigned transaction XDR and return signed XDR */
  signTransaction(unsignedTxXdr: string): Promise<string>;
}

