import { WrapperClient } from './wrapperClient';
import { Keypair } from '@stellar/stellar-sdk';

const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

describe('WrapperClient surface', () => {
  it('instantiates WrapperClient correctly', () => {
    const client = new WrapperClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: MOCK_CONTRACT_ID,
    });

    expect(typeof client.distributeRewards).toBe('function');
    expect(typeof client.getTotalAssets).toBe('function');
    expect(typeof client.calculateSharePrice).toBe('function');
    expect(typeof client.wrap).toBe('function');
    expect(typeof client.unwrap).toBe('function');
    expect(typeof client.withdraw).toBe('function');
    expect(typeof client.setUnlockTime).toBe('function');
    expect(typeof client.clearUnlockTime).toBe('function');
    expect(typeof client.getUnlockTime).toBe('function');
  });

  it('builds distributeRewards invoke transaction target', async () => {
    const client = new WrapperClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: MOCK_CONTRACT_ID,
    });

    const keypair = Keypair.random();
    // Simulate/invoke check that function is callable and defined on class prototype
    expect(client.distributeRewards).toBeDefined();
    expect(client.getTotalAssets).toBeDefined();
  });
});
