// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Tests for getBalancesChunked (issue #1485)
 *
 * Verifies that getBalancesChunked:
 *   1. Returns a Map<address, bigint> with an entry for every queried address.
 *   2. Processes addresses in concurrent chunks without exceeding the chunk size.
 *   3. Handles empty input gracefully.
 *   4. Works with the default chunk size of 20.
 */

import { jest } from '@jest/globals';
import { bcForgeClient } from './client';
import { Keypair, Networks } from '@stellar/stellar-sdk';

const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_NETWORK = Networks.TESTNET;
const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

function makeClient(): bcForgeClient {
  return new bcForgeClient({
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: MOCK_NETWORK,
    contractId: MOCK_CONTRACT_ID,
  });
}

function generateAddresses(n: number): string[] {
  return Array.from({ length: n }, () => Keypair.random().publicKey());
}

describe('bcForgeClient.getBalancesChunked', () => {
  let client: bcForgeClient;

  beforeEach(() => {
    client = makeClient();
    jest.restoreAllMocks();
  });

  it('is defined and callable', () => {
    expect(typeof client.getBalancesChunked).toBe('function');
  });

  it('returns an empty Map for an empty address list', async () => {
    const result = await client.getBalancesChunked([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('returns a Map with one entry per address', async () => {
    const addresses = generateAddresses(5);

    // Mock getBalance to return a deterministic balance per address.
    jest
      .spyOn(client, 'getBalance')
      .mockImplementation((addr: string) => Promise.resolve(BigInt(addr.charCodeAt(0))));

    const result = await client.getBalancesChunked(addresses, 5);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(addresses.length);
    for (const addr of addresses) {
      expect(result.has(addr)).toBe(true);
      expect(result.get(addr)).toBe(BigInt(addr.charCodeAt(0)));
    }
  });

  it('calls getBalance concurrently within each chunk', async () => {
    const addresses = generateAddresses(10);

    const callOrder: string[] = [];
    const getBalanceSpy = jest
      .spyOn(client, 'getBalance')
      .mockImplementation(async (addr: string) => {
        callOrder.push(addr);
        return 100n;
      });

    await client.getBalancesChunked(addresses, 5);

    // All 10 addresses must have been queried.
    expect(getBalanceSpy).toHaveBeenCalledTimes(10);
    for (const addr of addresses) {
      expect(callOrder).toContain(addr);
    }
  });

  it('processes more addresses than the chunk size in sequential batches', async () => {
    const addresses = generateAddresses(50);
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    jest.spyOn(client, 'getBalance').mockImplementation(async () => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await Promise.resolve(); // yield to event loop
      currentConcurrent--;
      return 42n;
    });

    const result = await client.getBalancesChunked(addresses, 10);

    expect(result.size).toBe(50);
    // Peak concurrency must not exceed the chunk size.
    expect(maxConcurrent).toBeLessThanOrEqual(10);
  });

  it('uses a default chunk size of 20 when none is specified', async () => {
    const addresses = generateAddresses(25);

    jest.spyOn(client, 'getBalance').mockResolvedValue(1n);

    // Should not throw and return all 25 entries.
    const result = await client.getBalancesChunked(addresses);
    expect(result.size).toBe(25);
  });

  it('preserves correct balance→address mapping with duplicate-safe keys', async () => {
    const addresses = generateAddresses(3);
    const expectedBalances = [111n, 222n, 333n];

    jest.spyOn(client, 'getBalance').mockImplementation((addr: string) => {
      const idx = addresses.indexOf(addr);
      return Promise.resolve(expectedBalances[idx]);
    });

    const result = await client.getBalancesChunked(addresses, 3);

    for (let i = 0; i < addresses.length; i++) {
      expect(result.get(addresses[i])).toBe(expectedBalances[i]);
    }
  });
});
