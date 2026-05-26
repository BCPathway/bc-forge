import { MockBcForgeClient } from './mockClient';

describe('MockBcForgeClient', () => {
  it('should mint and transfer tokens in-memory', async () => {
    const client = new MockBcForgeClient({} as any);
    await client.mint('A', 1000n);
    expect(await client.getBalance('A')).toBe(1000n);
    await client.transfer('A', 'B', 400n);
    expect(await client.getBalance('A')).toBe(600n);
    expect(await client.getBalance('B')).toBe(400n);
  });

  it('should handle allowances and transferFrom', async () => {
    const client = new MockBcForgeClient({} as any);
    await client.mint('A', 1000n);
    await client.approve('A', 'B', 500n);
    await client.transferFrom('A', 'B', 'C', 300n);
    expect(await client.getBalance('A')).toBe(700n);
    expect(await client.getBalance('C')).toBe(300n);
    expect(await client.getAllowance('A', 'B')).toBe(200n);
  });
});
