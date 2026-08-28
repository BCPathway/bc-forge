import { MockBcForgeClient } from './mockClient';

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
});
