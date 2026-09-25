import { describe, it, expect, vi } from 'vitest';
import { StrKey } from '@stellar/stellar-sdk';
import {
  DEFAULT_TTL_WARNING_LEDGERS,
  MINIMUM_TOOLCHAIN_VERSIONS,
  checkContractTtl,
  checkRpcHealth,
  checkToolchain,
  parseToolchainVersion,
  runDoctor
} from '../commands/doctor.js';
import type { DoctorRpc, VersionRunner } from '../commands/doctor.js';

const TOKEN_ID = StrKey.encodeContract(Buffer.alloc(32, 1));

/** Version runner stub returning canned banners, or throwing for a missing binary. */
function stubVersionRunner(impl: (command: string) => string | Promise<string>): VersionRunner {
  return (async (command) => impl(command)) as VersionRunner;
}

function stubRpc(
  health?: (() => Promise<Record<string, unknown>>) | Error,
  entries?: (() => Promise<{ entries: unknown[] }>) | Error
): DoctorRpc {
  return {
    getHealth: vi.fn(async () => {
      if (health instanceof Error) throw health;
      return health ? health() : { status: 'healthy' };
    }),
    getLedgerEntries: vi.fn(async () => {
      if (entries instanceof Error) throw entries;
      return entries ? entries() : { entries: [] };
    })
  } as unknown as DoctorRpc;
}

describe('doctor command (#940)', () => {
  describe('parseToolchainVersion', () => {
    it.each([
      ['rustc 1.74.1 (5995f1b5 2023-11-29)', '1.74.1'],
      ['stellar 22.0.0 (main)', '22.0.0'],
      ['stellar 23.1 (abc123)', '23.1'],
      ['no version here', undefined]
    ])('parses "%s" as %s', (output, expected) => {
      expect(parseToolchainVersion(output)).toBe(expected);
    });
  });

  describe('checkToolchain', () => {
    it('reports ok when rustc meets the CONTRIBUTING.md minimum', async () => {
      const runner = stubVersionRunner(() => 'rustc 1.74.1 (5995f1b5 2023-11-29)');
      const check = await checkToolchain('rustc', MINIMUM_TOOLCHAIN_VERSIONS.rustc, runner);
      expect(check.status).toBe('ok');
      expect(check.detail).toContain('1.74.1');
    });

    it('fails when the version is below the minimum', async () => {
      const runner = stubVersionRunner(() => 'rustc 1.70.0 (abc)');
      const check = await checkToolchain('rustc', MINIMUM_TOOLCHAIN_VERSIONS.rustc, runner);
      expect(check.status).toBe('fail');
      expect(check.detail).toMatch(/below the required 1\.74\.0/);
    });

    it('fails when the version banner cannot be parsed', async () => {
      const runner = stubVersionRunner(() => 'garbage output');
      const check = await checkToolchain('stellar', MINIMUM_TOOLCHAIN_VERSIONS.stellar, runner);
      expect(check.status).toBe('fail');
      expect(check.detail).toMatch(/Could not parse a version/);
    });

    it('fails when the binary cannot be run at all', async () => {
      const runner = stubVersionRunner(() => {
        throw new Error('ENOENT: no such file');
      });
      const check = await checkToolchain('stellar', MINIMUM_TOOLCHAIN_VERSIONS.stellar, runner);
      expect(check.status).toBe('fail');
      expect(check.detail).toMatch(/could not be run: ENOENT/);
    });

    it('treats the exact minimum version as satisfied', async () => {
      const runner = stubVersionRunner(() => 'stellar 22.0.0 (main)');
      const check = await checkToolchain('stellar', MINIMUM_TOOLCHAIN_VERSIONS.stellar, runner);
      expect(check.status).toBe('ok');
    });
  });

  describe('checkRpcHealth', () => {
    it('reports ok for a healthy RPC', async () => {
      const rpc = stubRpc(() => ({ status: 'healthy', latestLedger: 42 }));
      const check = await checkRpcHealth(rpc);
      expect(check.status).toBe('ok');
      expect(rpc.getHealth).toHaveBeenCalledTimes(1);
    });

    it('fails when the RPC reports a degraded status', async () => {
      const rpc = stubRpc(() => ({ status: 'overloaded' }));
      const check = await checkRpcHealth(rpc);
      expect(check.status).toBe('fail');
      expect(check.detail).toMatch(/overloaded/);
    });

    it('fails when the RPC is unreachable', async () => {
      const rpc = stubRpc(new Error('connect ECONNREFUSED'));
      const check = await checkRpcHealth(rpc);
      expect(check.status).toBe('fail');
      expect(check.detail).toMatch(/ECONNREFUSED/);
    });
  });

  describe('checkContractTtl', () => {
    it('reports ok while the instance TTL is above the warning threshold', async () => {
      const rpc = stubRpc(undefined, () => ({
        entries: [{ liveUntilLedgerSeq: DEFAULT_TTL_WARNING_LEDGERS + 1000 }]
      }));
      const check = await checkContractTtl(rpc, 'token', { contractId: TOKEN_ID }, 100_000);
      expect(check.status).toBe('ok');
      expect(check.detail).toMatch(/above|threshold/);
    });

    it('warns when the instance TTL falls below the warning threshold', async () => {
      const rpc = stubRpc(undefined, () => ({ entries: [{ liveUntilLedgerSeq: 1000 }] }));
      const check = await checkContractTtl(rpc, 'token', { contractId: TOKEN_ID }, 100_000);
      expect(check.status).toBe('warn');
      expect(check.detail).toMatch(/below the warning threshold/);
    });

    it('reports a missing TTL getter instead of guessing', async () => {
      const rpc = stubRpc(undefined, () => ({ entries: [{ key: 'instance' }] }));
      const check = await checkContractTtl(rpc, 'token', { contractId: TOKEN_ID }, 100_000);
      expect(check.status).toBe('warn');
      expect(check.detail).toMatch(/TTL getter absent/);
    });

    it('warns when the contract is not deployed', async () => {
      const rpc = stubRpc(undefined, () => ({ entries: [] }));
      const check = await checkContractTtl(rpc, 'token', { contractId: TOKEN_ID }, 100_000);
      expect(check.status).toBe('warn');
      expect(check.detail).toMatch(/not deployed/);
    });

    it('warns when no contractId is configured', async () => {
      const rpc = stubRpc(undefined, () => ({ entries: [] }));
      const check = await checkContractTtl(rpc, 'token', {}, 100_000);
      expect(check.status).toBe('warn');
      expect(check.detail).toMatch(/No contractId configured/);
    });

    it('warns when the RPC call rejects', async () => {
      const rpc = stubRpc(undefined, new Error('ledger entries unavailable'));
      const check = await checkContractTtl(rpc, 'token', { contractId: TOKEN_ID }, 100_000);
      expect(check.status).toBe('warn');
      expect(check.detail).toMatch(/TTL check failed/);
    });
  });

  describe('runDoctor', () => {
    it('aggregates toolchain, RPC, and TTL checks', async () => {
      const result = await runDoctor({
        versionRunner: stubVersionRunner((command) =>
          command === 'rustc' ? 'rustc 1.74.1 (x)' : 'stellar 22.0.0 (x)'
        ),
        rpc: stubRpc(undefined, () => ({
          entries: [{ liveUntilLedgerSeq: DEFAULT_TTL_WARNING_LEDGERS + 1 }]
        })),
        contracts: [{ name: 'token', deployment: { contractId: TOKEN_ID } }],
        ttlWarningLedgers: DEFAULT_TTL_WARNING_LEDGERS
      });

      expect(result.checks.map((c) => c.name)).toEqual([
        'rustc',
        'stellar',
        'rpc',
        'ttl:token'
      ]);
      expect(result.allOk).toBe(true);
      expect(result.checks.every((c) => c.status === 'ok')).toBe(true);
    });

    it('is not allOk when any check fails', async () => {
      const result = await runDoctor({
        versionRunner: stubVersionRunner(() => 'rustc 1.70.0 (x)'),
        rpc: stubRpc(undefined, () => ({ entries: [{ liveUntilLedgerSeq: 10 }] })),
        contracts: [{ name: 'token', deployment: { contractId: TOKEN_ID } }]
      });

      expect(result.checks.filter((c) => c.status === 'fail')).toHaveLength(1);
      expect(result.allOk).toBe(false);
    });

    it('skips RPC-dependent checks when no RPC is configured', async () => {
      const result = await runDoctor({
        versionRunner: stubVersionRunner(() => 'rustc 1.74.1 (x)')
      });

      expect(result.checks.map((c) => c.name)).toEqual(['rustc', 'stellar']);
    });
  });
});
