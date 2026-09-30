// SPDX-License-Identifier: MIT
import type {
  WalletAdapter,
  bcForgeClientConfig,
  TransactionResult,
} from '@bc-forge/sdk';

export const account =
  'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT';
export const networkPassphrase = 'Test SDF Network ; September 2015';
const result: TransactionResult = {
  success: true,
  hash: 'STORYBOOK_TRANSACTION_952',
};

/** Storybook-only SDK boundary: no transport or signing implementation. */
export class bcForgeClient {
  private adapter?: WalletAdapter;
  constructor(config: bcForgeClientConfig) {
    this.adapter = config.walletAdapter;
  }
  setWalletAdapter(adapter?: WalletAdapter) {
    this.adapter = adapter;
  }
  getWalletAdapter() {
    return this.adapter;
  }
  async mint() {
    return result;
  }
}

export class VaultClient {
  async getDecimals() {
    return 0;
  }
  async getShareBalance() {
    return 5000n;
  }
  async calculateRewards(amount: bigint) {
    return amount * 100n;
  }
  async deposit() {
    return result;
  }
}

/** In-memory wallet used by the real WalletProvider state machine. */
export class FreighterAdapter implements WalletAdapter {
  name = 'freighter';
  connected = false;
  publicKey?: string;
  networkPassphrase = networkPassphrase;
  async connect() {
    this.connected = true;
    this.publicKey = account;
  }
  async disconnect() {
    this.connected = false;
    this.publicKey = undefined;
  }
  async signTransaction(): Promise<string> {
    throw new Error('Storybook never signs transactions');
  }
}
export class AlbedoAdapter extends FreighterAdapter {
  name = 'albedo';
}

export async function calculateApy(): Promise<never> {
  throw new Error('Pass deterministic points to APYChart stories');
}
