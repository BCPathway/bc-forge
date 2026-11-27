// SPDX-License-Identifier: MIT
import { MockBcForgeClient, MockVaultClient } from './mockClient';

describe('MockBcForgeClient', () => {
  it('should mint and transfer tokens in-memory', async () => {
    const client = new MockBcForgeClient({} as any);
    await client.mint('admin', 'A', 1000n);
    expect(await client.getBalance('A')).toBe('0.0001000');
    await client.transfer('A', 'B', 400n);
    expect(await client.getBalance('A')).toBe('0.0000600');
    expect(await client.getBalance('B')).toBe('0.0000400');
  });

  it('should batch mint tokens in-memory', async () => {
    const client = new MockBcForgeClient({} as any);
    const result = await client.batchMint('admin', [
      { to: 'A', amount: 100n },
      { to: 'B', amount: 250n },
    ]);

    expect(result.success).toBe(true);
    expect(await client.getBalance('A')).toBe('0.0000100');
    expect(await client.getBalance('B')).toBe('0.0000250');
    expect(await client.getTotalSupply()).toBe(350n);
  });

  it('should handle allowances and transferFrom', async () => {
    const client = new MockBcForgeClient({} as any);
    await client.mint('admin', 'A', 1000n);
    await client.approve('A', 'B', 500n);
    await client.transferFrom('A', 'B', 'C', 300n);
    expect(await client.getBalance('A')).toBe('0.0000700');
    expect(await client.getBalance('C')).toBe('0.0000300');
    expect(await client.getAllowance('A', 'B')).toBe(200n);
  });

  it('should grant, revoke, and query the SuperAdmin role in-memory', async () => {
    const client = new MockBcForgeClient({} as any);
    const superAdmin = 'GSUPERADMIN123'; // arbitrary in-memory address

    expect(await client.hasRole('SuperAdmin', superAdmin)).toBe(false);

    const grant = await client.grantSuperAdmin(superAdmin);
    expect(grant.success).toBe(true);
    expect(await client.hasRole('SuperAdmin', superAdmin)).toBe(true);
    expect(await client.hasRole('Minter', superAdmin)).toBe(false);

    const revoke = await client.revokeSuperAdmin(superAdmin);
    expect(revoke.success).toBe(true);
    expect(await client.hasRole('SuperAdmin', superAdmin)).toBe(false);
  });

  it('should reject revoking a SuperAdmin role that is not held', async () => {
    const client = new MockBcForgeClient({} as any);
    const result = await client.revokeSuperAdmin('GSTRANGER123');
    expect(result.success).toBe(false);
  });

  it('should run initRbac and assign the initial SuperAdmin', async () => {
    const client = new MockBcForgeClient({} as any);
    const superAdmin = 'GSUPERADMIN456';

    const result = await client.initRbac(superAdmin);

    expect(result.migrate.success).toBe(true);
    expect(result.grant.success).toBe(true);
    expect(await client.hasRole('SuperAdmin', superAdmin)).toBe(true);
  });

  it('should reject operations when simulateRateLimit is enabled', async () => {
    const client = new MockBcForgeClient({ simulateRateLimit: true });

    const mintRes = await client.mint('admin', 'A', 1000n);
    expect(mintRes.success).toBe(false);
    expect(String(mintRes.returnValue)).toContain('RateLimitExceeded');
    expect(await client.getBalance('A')).toBe('0.0000000');

    const transferRes = await client.transfer('A', 'B', 100n);
    expect(transferRes.success).toBe(false);
    expect(String(transferRes.returnValue)).toContain('RateLimitExceeded');

    const rbacRes = await client.initRbac('GSUPERADMIN789');
    expect(rbacRes.migrate.success).toBe(false);
    expect(rbacRes.grant.success).toBe(false);

    // Disabling the flag restores normal behavior
    client.setSimulateRateLimit(false);
    const okMint = await client.mint('admin', 'A', 1000n);
    expect(okMint.success).toBe(true);
    expect(await client.getBalance('A')).toBe('0.0001000');
  });

  it('should reject operations when simulateReentrancy is enabled', async () => {
    const client = new MockBcForgeClient({ simulateReentrancy: true });

    const mintRes = await client.mint('admin', 'A', 500n);
    expect(mintRes.success).toBe(false);
    expect(String(mintRes.returnValue)).toContain('ReentrancyDetected');
    expect(await client.getTotalSupply()).toBe(0n);

    const approveRes = await client.approve('A', 'B', 100n);
    expect(approveRes.success).toBe(false);
    expect(String(approveRes.returnValue)).toContain('ReentrancyDetected');

    // Disabling the flag restores normal behavior
    client.setSimulateReentrancy(false);
    const okApprove = await client.approve('A', 'B', 100n);
    expect(okApprove.success).toBe(true);
    expect(await client.getAllowance('A', 'B')).toBe(100n);
  });
});

describe('MockVaultClient simulated failures', () => {
  it('should reject vault operations when simulateRateLimit or simulateReentrancy is enabled', async () => {
    const rateLimitedVault = new MockVaultClient({ simulateRateLimit: true });
    const depositRes = await rateLimitedVault.deposit('A', 1000n);
    expect(depositRes.success).toBe(false);
    expect(String(depositRes.returnValue)).toContain('RateLimitExceeded');
    expect(await rateLimitedVault.getTotalAssets()).toBe(0n);

    const reentrantVault = new MockVaultClient({ simulateReentrancy: true });
    const reentrantDeposit = await reentrantVault.deposit('A', 1000n);
    expect(reentrantDeposit.success).toBe(false);
    expect(String(reentrantDeposit.returnValue)).toContain('ReentrancyDetected');

    reentrantVault.setSimulateReentrancy(false);
    const okDeposit = await reentrantVault.deposit('A', 1000n);
    expect(okDeposit.success).toBe(true);
    expect(await reentrantVault.getTotalAssets()).toBe(1000n);
  });
});
