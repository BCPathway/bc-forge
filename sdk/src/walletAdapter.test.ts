// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Account, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  AlbedoAdapter,
  FreighterAdapter,
  LobstrAdapter,
  PrivateKeyAdapter,
  WalletConnectAdapter,
  XBullAdapter,
} from './index';

const TEST_ENV_VAR = 'BC_FORGE_TEST_SIGNER_SECRET';

type BrowserScope = typeof globalThis & {
  lobstrSignerExtensionApi?: unknown;
  lobstrApi?: unknown;
  xBullSDK?: unknown;
  xBull?: unknown;
};

function browserScope(): BrowserScope {
  return globalThis as BrowserScope;
}

function clearInjectedWallets(): void {
  const scope = browserScope();
  delete scope.lobstrSignerExtensionApi;
  delete scope.lobstrApi;
  delete scope.xBullSDK;
  delete scope.xBull;
}

function unsignedTransaction(source: Keypair): string {
  const account = new Account(source.publicKey(), '0');
  return new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.manageData({ name: 'bc-forge', value: '1' }))
    .setTimeout(30)
    .build()
    .toXDR();
}

describe('Wallet adapters basic surface', () => {
  afterEach(() => {
    clearInjectedWallets();
    delete process.env[TEST_ENV_VAR];
    delete process.env.STELLAR_SECRET_KEY;
  });

  it('provides adapter classes', () => {
    expect(typeof FreighterAdapter).toBe('function');
    expect(typeof AlbedoAdapter).toBe('function');
    expect(typeof WalletConnectAdapter).toBe('function');
    expect(typeof LobstrAdapter).toBe('function');
    expect(typeof XBullAdapter).toBe('function');
    expect(typeof PrivateKeyAdapter).toBe('function');
  });

  it('WalletConnectAdapter throws for unimplemented methods', async () => {
    const wc = new WalletConnectAdapter();
    await expect(wc.connect()).rejects.toThrow();
    await expect(wc.signTransaction('x')).rejects.toThrow();
  });

  describe('LobstrAdapter', () => {
    it('connects and signs through the injected Lobstr API', async () => {
      const publicKey = Keypair.random().publicKey();
      const signTransaction = jest.fn(async (xdr: string) => `signed:${xdr}`);
      browserScope().lobstrSignerExtensionApi = {
        isConnected: async () => true,
        getPublicKey: async () => publicKey,
        signTransaction,
      };

      const adapter = new LobstrAdapter();
      await adapter.connect();
      expect(adapter.connected).toBe(true);
      expect(adapter.publicKey).toBe(publicKey);

      const signed = await adapter.signTransaction('unsigned-xdr', {
        networkPassphrase: Networks.TESTNET,
      });
      expect(signed).toBe('signed:unsigned-xdr');
      expect(signTransaction).toHaveBeenCalledWith('unsigned-xdr', {
        networkPassphrase: Networks.TESTNET,
      });

      await adapter.disconnect();
      expect(adapter.connected).toBe(false);
      expect(adapter.publicKey).toBeUndefined();
    });

    it('accepts window.lobstrApi when the official global is absent', async () => {
      const publicKey = Keypair.random().publicKey();
      browserScope().lobstrApi = {
        getPublicKey: async () => publicKey,
        signTransaction: async () => 'signed-xdr',
      };

      const adapter = new LobstrAdapter();
      await adapter.connect();
      await expect(adapter.signTransaction('unsigned-xdr')).resolves.toBe('signed-xdr');
    });

    it('throws when the injected API is missing', async () => {
      const adapter = new LobstrAdapter();
      await expect(adapter.connect()).rejects.toThrow('Lobstr API not available');
      await expect(adapter.signTransaction('unsigned-xdr')).rejects.toThrow(
        'Lobstr API not available',
      );
    });
  });

  describe('XBullAdapter', () => {
    it('connects and signs through window.xBullSDK', async () => {
      const publicKey = Keypair.random().publicKey();
      const signXDR = jest.fn(async (xdr: string) => `signed:${xdr}`);
      const connect = jest.fn(async () => ({
        canRequestPublicKey: true,
        canRequestSign: true,
      }));
      browserScope().xBullSDK = {
        connect,
        getPublicKey: async () => publicKey,
        signXDR,
      };

      const adapter = new XBullAdapter();
      await adapter.connect();
      expect(connect).toHaveBeenCalledWith({
        canRequestPublicKey: true,
        canRequestSign: true,
      });
      expect(adapter.connected).toBe(true);
      expect(adapter.publicKey).toBe(publicKey);

      const signed = await adapter.signTransaction('unsigned-xdr', {
        networkPassphrase: Networks.TESTNET,
      });
      expect(signed).toBe('signed:unsigned-xdr');
      expect(signXDR).toHaveBeenCalledWith('unsigned-xdr', {
        network: Networks.TESTNET,
        networkPassphrase: Networks.TESTNET,
        publicKey,
      });
    });

    it('accepts window.xBull and a signedXDR object', async () => {
      const publicKey = Keypair.random().publicKey();
      browserScope().xBull = {
        getPublicKey: async () => ({ publicKey }),
        signTransaction: async () => ({ signedXDR: 'signed-xdr' }),
      };

      const adapter = new XBullAdapter();
      await adapter.connect();
      expect(adapter.publicKey).toBe(publicKey);
      await expect(adapter.signTransaction('unsigned-xdr')).resolves.toBe('signed-xdr');
    });

    it('throws when the injected API is missing', async () => {
      const adapter = new XBullAdapter();
      await expect(adapter.connect()).rejects.toThrow('xBull API not available');
      await expect(adapter.signTransaction('unsigned-xdr')).rejects.toThrow(
        'xBull API not available',
      );
    });
  });

  describe('PrivateKeyAdapter', () => {
    it('signs a transaction XDR with a random keypair', async () => {
      const source = Keypair.random();
      const unsigned = unsignedTransaction(source);
      const adapter = new PrivateKeyAdapter({
        secretKey: source.secret(),
        networkPassphrase: Networks.TESTNET,
      });

      await adapter.connect();
      expect(adapter.publicKey).toBe(source.publicKey());

      const signed = await adapter.signTransaction(unsigned);
      const parsed = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
      expect(parsed.signatures).toHaveLength(1);
      expect(source.verify(parsed.hash(), parsed.signatures[0].signature())).toBe(true);
    });

    it('reads a secret only from the environment variable the caller names', async () => {
      const source = Keypair.random();
      process.env[TEST_ENV_VAR] = source.secret();
      process.env.STELLAR_SECRET_KEY = 'not-consulted';

      const adapter = new PrivateKeyAdapter({
        envVar: TEST_ENV_VAR,
        networkPassphrase: Networks.TESTNET,
      });
      const signed = await adapter.signTransaction(unsignedTransaction(source));
      const parsed = TransactionBuilder.fromXDR(signed, Networks.TESTNET);
      expect(source.verify(parsed.hash(), parsed.signatures[0].signature())).toBe(true);

      delete process.env.STELLAR_SECRET_KEY;
    });

    it('throws when the caller does not supply a secret', () => {
      process.env.STELLAR_SECRET_KEY = Keypair.random().secret();
      expect(() => new PrivateKeyAdapter({})).toThrow(
        'PrivateKeyAdapter requires secretKey or envVar supplied by the caller',
      );
      delete process.env.STELLAR_SECRET_KEY;
    });
  });
});
