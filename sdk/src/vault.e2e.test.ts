/**
 * @bc-forge/sdk — E2E Integration Test: Token -> Vault -> Compound flow (#740)
 *
 * Full lifecycle integration test covering:
 * Mint -> Vault Deposit -> Fee Generation -> Compound -> Vault Withdraw
 */

import { MockBcForgeClient, MockVaultClient } from './mockClient';

describe('E2E Integration: Token -> Vault -> Compound Flow (#740)', () => {
  let tokenClient: MockBcForgeClient;
  let vaultClient: MockVaultClient;

  const admin = 'GADMINXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const userA = 'GUSERAXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const userB = 'GUSERBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
  const feePayer = 'GFEEGENERATORXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

  beforeEach(() => {
    tokenClient = new MockBcForgeClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CTOKEN00000000000000000000000000000000000000000000000000',
    });

    vaultClient = new MockVaultClient({
      rpcUrl: 'https://soroban-testnet.stellar.org',
      networkPassphrase: 'Test SDF Network ; September 2015',
      contractId: 'CVAULT00000000000000000000000000000000000000000000000000',
    });
  });

  it('completes the full lifecycle: Mint -> Vault Deposit -> Fee Generation -> Compound -> Vault Withdraw', async () => {
    // ─── 1. MINT ─────────────────────────────────────────────────────────────
    // Admin mints 1,000,000 atomic units to userA and 500,000 to feePayer
    const mintUserRes = await tokenClient.mint(admin, userA, 1_000_000n);
    expect(mintUserRes.success).toBe(true);

    const mintFeeRes = await tokenClient.mint(admin, feePayer, 500_000n);
    expect(mintFeeRes.success).toBe(true);

    expect(await tokenClient.getBalance(userA)).toBe('0.1000000'); // 7 decimals
    expect(await tokenClient.getTotalSupply()).toBe(1_500_000n);

    // ─── 2. VAULT DEPOSIT ───────────────────────────────────────────────────
    // UserA approves and deposits 1,000,000 tokens into the vault
    const depositAmount = 1_000_000n;
    const approveRes = await tokenClient.approve(
      userA,
      'CVAULT00000000000000000000000000000000000000000000000000',
      depositAmount,
    );
    expect(approveRes.success).toBe(true);

    // Initial deposit: 1:1 ratio -> 1,000,000 shares minted
    const depositRes = await vaultClient.deposit(userA, depositAmount, null, 990_000n);
    expect(depositRes.success).toBe(true);
    expect(depositRes.returnValue).toBe(1_000_000n);

    expect(await vaultClient.getShareBalance(userA)).toBe(1_000_000n);
    expect(await vaultClient.getTotalAssets()).toBe(1_000_000n);
    expect(await vaultClient.getTotalSupply()).toBe(1_000_000n);
    expect(await vaultClient.calculateSharePrice()).toBe(1n);

    // ─── 3. FEE GENERATION ──────────────────────────────────────────────────
    // Fee generator sends 200,000 reward/fee tokens into the vault
    const feeAmount = 200_000n;
    const feeDistRes = await vaultClient.distributeRewards(feePayer, feeAmount);
    expect(feeDistRes.success).toBe(true);

    expect(await vaultClient.getTotalAssets()).toBe(1_200_000n);
    expect(await vaultClient.getPendingRewards()).toBe(200_000n);
    // Shares unchanged at 1,000,000, but assets increased to 1,200,000
    expect(await vaultClient.getTotalSupply()).toBe(1_000_000n);

    // ─── 4. COMPOUND ────────────────────────────────────────────────────────
    // Compound pending fees into vault pool
    const compoundRes = await vaultClient.compound(admin);
    expect(compoundRes.success).toBe(true);
    expect(await vaultClient.getPendingRewards()).toBe(0n);

    // Total assets is 1,200,000 for 1,000,000 shares
    // Share price = 1_200_000 / 1_000_000 = 1 (with integer math)
    // Pro-rata rewards entitlement for userA's 1,000,000 shares:
    const userEntitlement = await vaultClient.calculateRewards(1_000_000n);
    expect(userEntitlement).toBe(1_200_000n);

    // ─── 5. VAULT WITHDRAW ──────────────────────────────────────────────────
    // UserA withdraws all 1,000,000 shares and receives 1,200,000 underlying tokens (principal + yield)
    const withdrawRes = await vaultClient.withdraw(userA, 1_000_000n, null, 1_190_000n);
    expect(withdrawRes.success).toBe(true);
    expect(withdrawRes.returnValue).toBe(1_200_000n); // 200,000 yield received!

    // Verify vault balances after withdrawal
    expect(await vaultClient.getShareBalance(userA)).toBe(0n);
    expect(await vaultClient.getTotalSupply()).toBe(0n);
    expect(await vaultClient.getTotalAssets()).toBe(0n);
  });

  it('handles multi-user deposit, fee distribution, compounding, and fair pro-rata withdrawals', async () => {
    // 1. Mint tokens to UserA (1,000,000) and UserB (1,000,000)
    await tokenClient.mint(admin, userA, 1_000_000n);
    await tokenClient.mint(admin, userB, 1_000_000n);

    // 2. UserA deposits 1,000,000 tokens
    await vaultClient.deposit(userA, 1_000_000n);

    // 3. Protocol generates 500,000 fees and compounds
    await vaultClient.distributeRewards(feePayer, 500_000n);
    await vaultClient.compound(admin);
    // Vault now has: assets = 1,500,000, shares = 1,000,000

    // 4. UserB deposits 1,500,000 tokens at the updated rate
    // sharesOut = (1,500,000 * 1,000,000) / 1,500,000 = 1,000,000 shares
    const userBDeposit = await vaultClient.deposit(userB, 1_500_000n);
    expect(userBDeposit.success).toBe(true);
    expect(userBDeposit.returnValue).toBe(1_000_000n);

    // Now totalAssets = 3,000,000, totalShares = 2,000,000 (UserA has 1M, UserB has 1M)
    expect(await vaultClient.getTotalAssets()).toBe(3_000_000n);
    expect(await vaultClient.getTotalSupply()).toBe(2_000_000n);

    // 5. Additional 1,000,000 fee generation and compound
    await vaultClient.distributeRewards(feePayer, 1_000_000n);
    await vaultClient.compound(admin);
    // TotalAssets = 4,000,000, TotalShares = 2,000,000

    // 6. UserA withdraws 1M shares -> receives (1M * 4M) / 2M = 2,000,000 tokens
    const userAWithdraw = await vaultClient.withdraw(userA, 1_000_000n);
    expect(userAWithdraw.success).toBe(true);
    expect(userAWithdraw.returnValue).toBe(2_000_000n);

    // 7. UserB withdraws 1M shares -> receives (1M * 2M) / 1M = 2,000,000 tokens
    const userBWithdraw = await vaultClient.withdraw(userB, 1_000_000n);
    expect(userBWithdraw.success).toBe(true);
    expect(userBWithdraw.returnValue).toBe(2_000_000n);

    // Vault is completely drained cleanly
    expect(await vaultClient.getTotalSupply()).toBe(0n);
    expect(await vaultClient.getTotalAssets()).toBe(0n);
  });

  it('verifies error states across the lifecycle', async () => {
    // Deposit 0 tokens -> rejects
    const zeroDep = await vaultClient.deposit(userA, 0n);
    expect(zeroDep.success).toBe(false);

    // Withdraw with zero shares -> rejects
    const zeroWith = await vaultClient.withdraw(userA, 0n);
    expect(zeroWith.success).toBe(false);

    // Withdraw with no deposit -> InsufficientBalance
    const noDepWith = await vaultClient.withdraw(userA, 1000n);
    expect(noDepWith.success).toBe(false);
    expect(noDepWith.returnValue).toContain('InsufficientBalance');

    // Negative rewards -> rejects
    const negRew = await vaultClient.distributeRewards(feePayer, -100n);
    expect(negRew.success).toBe(false);

    // Calculating rewards on 0 total shares throws ZeroShares
    await expect(vaultClient.calculateSharePrice()).rejects.toThrow('ZeroShares');
  });
});
