import { SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';
import {
  detectGap,
  startupGapCheck,
  runIndexer,
  GAP_THRESHOLD,
} from '../indexer';

// ═══════════════════════════════════════════════════════════════════════════
//  Module-level mocks
//
//  The factory functions use `var` declarations for their shared mock
//  objects.  `var` is hoisted to the top of the scope so the closure
//  created inside the `jest.mock` factory can reference the same variable
//  that the test code assigns to.
//
//  Because the factory assigns the var BEFORE the import loads, the
//  `new PrismaClient()` / `new SorobanRpc.Server(...)` calls in the
//  indexer module will receive the controlled mock objects.
// ═══════════════════════════════════════════════════════════════════════════

var mockPrismaClientInstance: any;
var mockServerInstance: any;

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('@prisma/client', () => {
  mockPrismaClientInstance = {
    lastIndexedLedger: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    mint: { create: jest.fn() },
    transfer: { create: jest.fn() },
    burn: { create: jest.fn() },
  };
  return { PrismaClient: jest.fn(() => mockPrismaClientInstance) };
});

jest.mock('@stellar/stellar-sdk', () => {
  mockServerInstance = {
    getLatestLedger: jest.fn(),
    getEvents: jest.fn(),
  };
  return {
    SorobanRpc: { Server: jest.fn(() => mockServerInstance), Api: {} },
    xdr: {},
    scValToNative: jest.fn(),
  };
});

// ── Console spies ─────────────────────────────────────────────────────────

let consoleLogSpy: jest.SpyInstance;
let consoleWarnSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();

  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
//  detectGap — pure function (no mocking required)
// ═══════════════════════════════════════════════════════════════════════════

describe('detectGap', () => {
  it('returns first-run info when no stored ledger (null)', () => {
    const result = detectGap(null, 50000);
    expect(result).toEqual({
      startLedger: 1, isGap: false, gapSize: 0, isFirstRun: true,
    });
  });

  it('returns first-run info when stored ledger is undefined', () => {
    const result = detectGap(undefined, 50000);
    expect(result).toEqual({
      startLedger: 1, isGap: false, gapSize: 0, isFirstRun: true,
    });
  });

  it('returns normal start when gap is below the threshold', () => {
    const result = detectGap(500, 510);
    expect(result).toEqual({
      startLedger: 501, isGap: false, gapSize: 9, isFirstRun: false,
    });
  });

  it('detects a large gap above the threshold', () => {
    const result = detectGap(500, 50000);
    expect(result).toEqual({
      startLedger: 501, isGap: true, gapSize: 49499, isFirstRun: false,
    });
  });

  it('does not flag a gap when exactly at the threshold (gapSize === threshold)', () => {
    const at = 500 + GAP_THRESHOLD + 1;
    const result = detectGap(500, at);
    expect(result.isGap).toBe(false);
    expect(result.gapSize).toBe(GAP_THRESHOLD);
    expect(result.startLedger).toBe(501);
  });

  it('flags a gap when one ledger above the threshold', () => {
    const at = 500 + GAP_THRESHOLD + 2;
    const result = detectGap(500, at);
    expect(result.isGap).toBe(true);
    expect(result.gapSize).toBe(GAP_THRESHOLD + 1);
  });

  it('resets startLedger when stored ledger is ahead of the network', () => {
    const result = detectGap(50000, 100);
    expect(result).toEqual({
      startLedger: 100, isGap: true, gapSize: 0, isFirstRun: false,
    });
  });

  it('resets startLedger when stored and current are equal', () => {
    const result = detectGap(500, 500);
    expect(result).toEqual({
      startLedger: 500, isGap: true, gapSize: 0, isFirstRun: false,
    });
  });

  it('throws when currentLedger is 0', () => {
    expect(() => detectGap(500, 0)).toThrow('Invalid currentLedger: 0');
  });

  it('throws when currentLedger is negative', () => {
    expect(() => detectGap(500, -1)).toThrow('Invalid currentLedger: -1');
  });

  it('handles first run with currentLedger = 1', () => {
    const result = detectGap(null, 1);
    expect(result).toEqual({
      startLedger: 1, isGap: false, gapSize: 0, isFirstRun: true,
    });
  });

  it('handles storedLedger = 0 (edge case)', () => {
    const result = detectGap(0, 100);
    expect(result).toEqual({
      startLedger: 1, isGap: false, gapSize: 99, isFirstRun: false,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  startupGapCheck — integration with mocked Prisma + SorobanRpc
// ═══════════════════════════════════════════════════════════════════════════

describe('startupGapCheck', () => {
  it('returns startLedger = 1 on first run', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue(
      null,
    );
    mockServerInstance.getLatestLedger.mockResolvedValue({ sequence: 50000 });

    const result = await startupGapCheck();

    expect(result).toBe(1);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Resuming from ledger 1'),
    );
  });

  it('returns storedLedger + 1 when no significant gap', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 500,
    });
    mockServerInstance.getLatestLedger.mockResolvedValue({ sequence: 510 });

    const result = await startupGapCheck();

    expect(result).toBe(501);
  });

  it('detects and logs a large gap', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 500,
    });
    mockServerInstance.getLatestLedger.mockResolvedValue({ sequence: 50000 });

    const result = await startupGapCheck();

    expect(result).toBe(501);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gap detected'),
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('gap='),
    );
  });

  it('resets startLedger when stored ledger is ahead of the network', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 50000,
    });
    mockServerInstance.getLatestLedger.mockResolvedValue({ sequence: 100 });

    const result = await startupGapCheck();

    expect(result).toBe(100);
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ahead of the network'),
    );
  });

  it('propagates RPC errors', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 500,
    });
    mockServerInstance.getLatestLedger.mockRejectedValue(
      new Error('RPC unavailable'),
    );

    await expect(startupGapCheck()).rejects.toThrow('RPC unavailable');
  });

  it('propagates Prisma errors', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockRejectedValue(
      new Error('DB down'),
    );
    mockServerInstance.getLatestLedger.mockResolvedValue({ sequence: 50000 });

    await expect(startupGapCheck()).rejects.toThrow('DB down');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  runIndexer — integration tests
// ═══════════════════════════════════════════════════════════════════════════

describe('runIndexer', () => {
  it('detects and logs a gap on startup', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 500,
    });
    mockServerInstance.getLatestLedger
      .mockResolvedValueOnce({ sequence: 50000 })
      .mockRejectedValue(new Error('exit'));
    mockServerInstance.getEvents.mockResolvedValue({ events: [] });

    jest.spyOn(global, 'setTimeout').mockImplementation((() => {
      throw new Error('loop exit');
    }) as any);

    await expect(runIndexer()).rejects.toThrow();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Starting indexer'),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gap detected'),
    );
  });

  it('starts from ledger 1 on first run', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue(
      null,
    );
    mockServerInstance.getLatestLedger
      .mockResolvedValueOnce({ sequence: 100 })
      .mockRejectedValue(new Error('exit'));
    mockServerInstance.getEvents.mockResolvedValue({ events: [] });

    jest.spyOn(global, 'setTimeout').mockImplementation((() => {
      throw new Error('loop exit');
    }) as any);

    await expect(runIndexer()).rejects.toThrow();

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('ledger 1'),
    );
  });

  it('processes a batch and updates LastIndexedLedger when caught up', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 500,
    });
    mockServerInstance.getLatestLedger
      .mockResolvedValueOnce({ sequence: 510 })
      .mockResolvedValueOnce({ sequence: 510 })
      .mockRejectedValue(new Error('exit'));
    mockServerInstance.getEvents.mockResolvedValue({ events: [] });

    jest.spyOn(global, 'setTimeout').mockImplementation((() => {
      throw new Error('loop exit');
    }) as any);

    await expect(runIndexer()).rejects.toThrow();

    expect(mockPrismaClientInstance.lastIndexedLedger.upsert)
      .toHaveBeenCalledWith({
        where: { id: 1 },
        update: { ledger: 510 },
        create: { id: 1, ledger: 510 },
      });
  });

  it('reports RPC errors inside the loop without crashing', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 500,
    });
    mockServerInstance.getLatestLedger
      .mockResolvedValueOnce({ sequence: 510 })
      .mockRejectedValueOnce(new Error('RPC glitch'));
    mockServerInstance.getEvents.mockResolvedValue({ events: [] });

    jest.spyOn(global, 'setTimeout')
      .mockImplementationOnce((
        (fn: () => void) => { fn(); return {} as any; }
      ) as any)
      .mockImplementation((() => { throw new Error('loop exit'); }) as any);

    await expect(runIndexer()).rejects.toThrow();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Indexer error:', expect.any(Error),
    );
  });

  it('handles stored > current on startup gracefully', async () => {
    mockPrismaClientInstance.lastIndexedLedger.findUnique.mockResolvedValue({
      id: 1, ledger: 50000,
    });
    mockServerInstance.getLatestLedger
      .mockResolvedValueOnce({ sequence: 100 })
      .mockRejectedValue(new Error('exit'));
    mockServerInstance.getEvents.mockResolvedValue({ events: [] });

    jest.spyOn(global, 'setTimeout').mockImplementation((() => {
      throw new Error('loop exit');
    }) as any);

    await expect(runIndexer()).rejects.toThrow();

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('ahead of the network'),
    );
  });
});
