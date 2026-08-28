import { jest } from '@jest/globals';
import { VaultClient } from './vaultClient';
import { MockVaultClient } from './mockClient';
import { Keypair } from '@stellar/stellar-sdk';

const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_PASSPHRASE = 'Test SDF Network ; September 2015';

describe('VaultClient surface and methods', () => {
  let client: VaultClient;

  beforeEach(() => {
    client = new VaultClient({
      rpcUrl: MOCK_RPC_URL,
      networkPassphrase: MOCK_PASSPHRASE,
      contractId: MOCK_CONTRACT_ID,
    });
  });

  it('instantiates VaultClient correctly and exposes required methods', () => {
    expect(typeof client.deposit).toBe('function');
    expect(typeof client.withdraw).toBe('function');
    expect(typeof client.compound).toBe('function');
    expect(typeof client.compoundFees).toBe('function');
    expect(typeof client.distributeRewards).toBe('function');
    expect(typeof client.getTotalAssets).toBe('function');
    expect(typeof client.getTotalSupply).toBe('function');
    expect(typeof client.getBalance).toBe('function');
    expect(typeof client.getShareBalance).toBe('function');
    expect(typeof client.getPendingRewards).toBe('function');
    expect(typeof client.calculateSharePrice).toBe('function');
    expect(typeof client.calculateRewards).toBe('function');
    expect(typeof client.getUnderlyingToken).toBe('function');
    expect(typeof client.getUnlockTime).toBe('function');
    expect(typeof client.setUnlockTime).toBe('function');
    expect(typeof client.clearUnlockTime).toBe('function');
    expect(typeof client.transfer).toBe('function');
    expect(typeof client.approve).toBe('function');
    expect(typeof client.transferFrom).toBe('function');
    expect(typeof client.buildDepositTx).toBe('function');
    expect(typeof client.buildWithdrawTx).toBe('function');
    expect(typeof client.buildCompoundTx).toBe('function');
    expect(typeof client.buildDistributeRewardsTx).toBe('function');
    expect(typeof client.simulateDeposit).toBe('function');
    expect(typeof client.simulateWithdraw).toBe('function');
    expect(typeof client.simulateCompound).toBe('function');
    expect(typeof client.signTx).toBe('function');
  });

  it('handles deposit invocation with and without slippage tolerance', async () => {
    const invokeContract = jest.fn(async (_method: string, _args: unknown[], _source: Keypair) => ({
      success: true,
      hash: 'mock-hash',
      returnValue: 1000n,
    }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    const user = source.publicKey();

    // 1. Call deposit without minSharesOut
    const res1 = await client.deposit(user, 1000n, source);
    expect(res1.success).toBe(true);
    expect(invokeContract).toHaveBeenCalledWith('deposit', expect.any(Array), source);

    // 2. Call deposit with minSharesOut
    const res2 = await client.deposit(user, 1000n, source, 950n);
    expect(res2.success).toBe(true);
    expect(invokeContract).toHaveBeenCalledTimes(2);
  });

  it('handles withdraw invocation with and without minTokensOut', async () => {
    const invokeContract = jest.fn(async (_method: string, _args: unknown[], _source: Keypair) => ({
      success: true,
      hash: 'mock-hash',
      returnValue: 1050n,
    }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    const user = source.publicKey();

    // 1. Call withdraw without minTokensOut
    const res1 = await client.withdraw(user, 500n, source);
    expect(res1.success).toBe(true);

    // 2. Call withdraw with minTokensOut
    const res2 = await client.withdraw(user, 500n, source, 490n);
    expect(res2.success).toBe(true);
    expect(invokeContract).toHaveBeenCalledTimes(2);
  });

  it('handles compound and compoundFees invocation', async () => {
    const invokeContract = jest.fn(async (_method: string, _args: unknown[], _source: Keypair) => ({
      success: true,
      hash: 'mock-hash',
      returnValue: null,
    }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    const caller = source.publicKey();

    const res1 = await client.compound(caller, source);
    expect(res1.success).toBe(true);

    const res2 = await client.compoundFees(caller, source);
    expect(res2.success).toBe(true);
    expect(invokeContract).toHaveBeenCalledTimes(2);
  });
});

describe('MockVaultClient Unit Tests', () => {
  let mockVault: MockVaultClient;
  const userA = 'GA111111111111111111111111111111111111111111111111111111';
  const userB = 'GB222222222222222222222222222222222222222222222222222222';

  beforeEach(() => {
    mockVault = new MockVaultClient();
  });

  it('performs basic deposit and withdraw lifecycle with 1:1 initial rate', async () => {
    // 1. User deposits 1,000,000 units
    const depRes = await mockVault.deposit(userA, 1_000_000n);
    expect(depRes.success).toBe(true);
    expect(depRes.returnValue).toBe(1_000_000n);

    expect(await mockVault.getShareBalance(userA)).toBe(1_000_000n);
    expect(await mockVault.getTotalAssets()).toBe(1_000_000n);
    expect(await mockVault.getTotalSupply()).toBe(1_000_000n);
    expect(await mockVault.calculateSharePrice()).toBe(1n);

    // 2. User withdraws 400,000 shares
    const withRes = await mockVault.withdraw(userA, 400_000n);
    expect(withRes.success).toBe(true);
    expect(withRes.returnValue).toBe(400_000n);

    expect(await mockVault.getShareBalance(userA)).toBe(600_000n);
    expect(await mockVault.getTotalAssets()).toBe(600_000n);
    expect(await mockVault.getTotalSupply()).toBe(600_000n);
  });

  it('reverts on deposit with zero or negative amount', async () => {
    const resZero = await mockVault.deposit(userA, 0n);
    expect(resZero.success).toBe(false);
    expect(resZero.returnValue).toContain('InvalidAmount');

    const resNeg = await mockVault.deposit(userA, -500n);
    expect(resNeg.success).toBe(false);
    expect(resNeg.returnValue).toContain('InvalidAmount');
  });

  it('reverts on withdraw with zero or insufficient shares', async () => {
    const resZero = await mockVault.withdraw(userA, 0n);
    expect(resZero.success).toBe(false);
    expect(resZero.returnValue).toContain('InvalidAmount');

    const resInsuff = await mockVault.withdraw(userA, 100n);
    expect(resInsuff.success).toBe(false);
    expect(resInsuff.returnValue).toContain('InsufficientBalance');
  });

  it('reverts when slippage condition is violated on deposit and withdraw', async () => {
    // Deposit with minSharesOut higher than calculated
    const depFail = await mockVault.deposit(userA, 1000n, null, 1500n);
    expect(depFail.success).toBe(false);
    expect(depFail.returnValue).toContain('SlippageExceeded');

    // Deposit succeeds
    await mockVault.deposit(userA, 1000n);

    // Withdraw with minTokensOut higher than calculated
    const withFail = await mockVault.withdraw(userA, 500n, null, 600n);
    expect(withFail.success).toBe(false);
    expect(withFail.returnValue).toContain('SlippageExceeded');
  });

  it('handles transfer and allowance correctly', async () => {
    await mockVault.deposit(userA, 1000n);
    const transferRes = await mockVault.transfer(userA, userB, 400n);
    expect(transferRes.success).toBe(true);

    expect(await mockVault.getShareBalance(userA)).toBe(600n);
    expect(await mockVault.getShareBalance(userB)).toBe(400n);

    const approveRes = await mockVault.approve(userA, userB, 200n);
    expect(approveRes.success).toBe(true);
    expect(await mockVault.getAllowance(userA, userB)).toBe(200n);
  });
});
