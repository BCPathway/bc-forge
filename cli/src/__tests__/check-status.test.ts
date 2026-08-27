import { describe, it, expect, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import {
  checkStatus,
  collectContracts,
  pingContract,
  type StatusChecker
} from '../commands/check-status.js';
import type { BcForgeConfig } from '../utils/config-parser.js';

const TOKEN_ID = StrKey.encodeContract(Buffer.alloc(32, 1));
const WRAPPER_ID = StrKey.encodeContract(Buffer.alloc(32, 2));

/** Builds a stub RPC server whose getLedgerEntries behaviour is scripted per call. */
function stubServer(
  impl: (...keys: any[]) => Promise<{ entries: unknown[] }>
): StatusChecker {
  return { getLedgerEntries: vi.fn(impl) as any } as StatusChecker;
}

/** Deterministic clock producing a fixed 25ms delta per measured span. */
function fakeClock(step = 25) {
  let current = 0;
  return () => {
    const value = current;
    current += step;
    return value;
  };
}

function baseConfig(contracts: BcForgeConfig['contracts']): BcForgeConfig {
  return {
    name: 'Test Token',
    symbol: 'TTK',
    network: 'testnet',
    contracts
  };
}

describe('CLI check-status command (#699)', () => {
  describe('collectContracts', () => {
    it('returns every contract declared in the configuration', () => {
      const config = baseConfig({
        token: { contractId: TOKEN_ID },
        wrapper: { contractId: WRAPPER_ID }
      });

      const collected = collectContracts(config);

      expect(collected).toHaveLength(2);
      expect(collected.map(c => c.name).sort()).toEqual(['token', 'wrapper']);
    });

    it('returns an empty list when no contracts are declared', () => {
      expect(collectContracts(baseConfig(undefined))).toEqual([]);
    });
  });

  describe('pingContract', () => {
    it('reports a responsive contract with measured latency', async () => {
      const server = stubServer(async () => ({ entries: [{ key: 'instance' }] }));

      const report = await pingContract(
        server,
        'token',
        { contractId: TOKEN_ID },
        fakeClock()
      );

      expect(report.status).toBe('responsive');
      expect(report.contractId).toBe(TOKEN_ID);
      expect(report.latencyMs).toBe(25);
      expect(report.error).toBeUndefined();
    });

    it('reports not_deployed when the RPC returns no instance entry', async () => {
      const server = stubServer(async () => ({ entries: [] }));

      const report = await pingContract(
        server,
        'token',
        { contractId: TOKEN_ID },
        fakeClock()
      );

      expect(report.status).toBe('not_deployed');
      expect(report.error).toMatch(/No contract instance/);
      expect(report.latencyMs).toBe(25);
    });

    it('reports unreachable when the RPC call rejects', async () => {
      const server = stubServer(async () => {
        throw new Error('connect ECONNREFUSED');
      });

      const report = await pingContract(
        server,
        'token',
        { contractId: TOKEN_ID },
        fakeClock()
      );

      expect(report.status).toBe('unreachable');
      expect(report.error).toMatch(/ECONNREFUSED/);
      expect(report.latencyMs).toBe(25);
    });

    it('reports invalid when the configured contract id is malformed', async () => {
      const server = stubServer(async () => ({ entries: [{ key: 'instance' }] }));

      const report = await pingContract(
        server,
        'token',
        { contractId: 'NOT-A-CONTRACT-ID' },
        fakeClock()
      );

      expect(report.status).toBe('invalid');
      expect(server.getLedgerEntries).not.toHaveBeenCalled();
    });

    it('reports invalid when no contract id is configured', async () => {
      const server = stubServer(async () => ({ entries: [{ key: 'instance' }] }));

      const report = await pingContract(server, 'token', {}, fakeClock());

      expect(report.status).toBe('invalid');
      expect(report.error).toMatch(/No contractId configured/);
      expect(server.getLedgerEntries).not.toHaveBeenCalled();
    });
  });

  describe('checkStatus', () => {
    it('marks all responsive when every contract answers', async () => {
      const server = stubServer(async () => ({ entries: [{ key: 'instance' }] }));
      const config = baseConfig({
        token: { contractId: TOKEN_ID },
        wrapper: { contractId: WRAPPER_ID }
      });

      const result = await checkStatus(server, config, 'https://rpc.example', fakeClock());

      expect(result.allResponsive).toBe(true);
      expect(result.reports).toHaveLength(2);
      expect(result.network).toBe('testnet');
      expect(result.rpcUrl).toBe('https://rpc.example');
    });

    it('marks not all responsive when a single contract fails', async () => {
      const server = stubServer(async () => ({ entries: [] }));
      const config = baseConfig({
        token: { contractId: TOKEN_ID },
        wrapper: { contractId: WRAPPER_ID }
      });

      const result = await checkStatus(server, config, 'https://rpc.example', fakeClock());

      expect(result.allResponsive).toBe(false);
      expect(result.reports.every(r => r.status === 'not_deployed')).toBe(true);
    });

    it('is not responsive when the configuration declares no contracts', async () => {
      const server = stubServer(async () => ({ entries: [{ key: 'instance' }] }));

      const result = await checkStatus(
        server,
        baseConfig(undefined),
        'https://rpc.example',
        fakeClock()
      );

      expect(result.reports).toEqual([]);
      expect(result.allResponsive).toBe(false);
    });
  });
});
