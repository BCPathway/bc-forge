import { FreighterAdapter, AlbedoAdapter, WalletConnectAdapter } from './index';

describe('Wallet adapters basic surface', () => {
  it('provides adapter classes', () => {
    expect(typeof FreighterAdapter).toBe('function');
    expect(typeof AlbedoAdapter).toBe('function');
    expect(typeof WalletConnectAdapter).toBe('function');
  });

  it('WalletConnectAdapter throws for unimplemented methods', async () => {
    const wc = new WalletConnectAdapter();
    await expect(wc.connect()).rejects.toThrow();
    await expect(wc.signTransaction('x')).rejects.toThrow();
  });
});
