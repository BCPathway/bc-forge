var mockGetLatestLedger = jest.fn();
var mockGetEvents = jest.fn();

process.env.CONTRACT_ID = 'CCONTRACT_ABC_123';
import { runIndexer } from './indexer';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { PrismaClient } from '@prisma/client';

// Mock the dependencies
jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getLatestLedger: () => mockGetLatestLedger(),
        getEvents: (req: any) => mockGetEvents(req),
      })),
    },
    // Mock scValToNative to return mock structures for simplicity
    scValToNative: jest.fn((val) => {
      if (val === 'mint') return 'mint';
      if (val === 'xfer') return 'xfer';
      return ['admin', 'recipient-1', BigInt(1000)]; // Mock decoded event data array
    }),
  };
});

jest.mock('@prisma/client', () => {
  const mockPrismaInstance = {
    lastIndexedLedger: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    mint: {
      create: jest.fn(),
    },
    transfer: {
      create: jest.fn(),
    },
    burn: {
      create: jest.fn(),
    },
  };
  return {
    PrismaClient: jest.fn().mockImplementation(() => mockPrismaInstance),
  };
});

describe('Indexer Duplicate Event Processing Regression Test', () => {
  let prisma: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONTRACT_ID = 'CCONTRACT_ABC_123';
    prisma = new PrismaClient();
  });

  it('should restrict getEvents queries to the target ledger range and write unique eventIds to database', async () => {
    prisma.lastIndexedLedger.findUnique.mockResolvedValue({ id: 1, ledger: 1000 });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('Break indexer loop for test');
    });

    mockGetEvents.mockResolvedValue({ events: [] });

    // Let's make getLatestLedger throw an error after the first iteration to break the loop
    let count = 0;
    mockGetLatestLedger.mockImplementation(async () => {
      count++;
      if (count > 1) {
        throw new Error('Break indexer loop for test');
      }
      return { sequence: 1050 };
    });

    try {
      await runIndexer();
    } catch (e: any) {
      expect(e.message).toBe('Break indexer loop for test');
    } finally {
      consoleErrorSpy.mockRestore();
    }

    // Verify startLedger and endLedger in getEvents
    // startLedger = lastLedger.ledger + 1 = 1001
    // endLedger = Math.min(1001 + 1000, 1050) = 1050
    // endLedger + 1 is passed as exclusive upper bound: 1051
    expect(mockGetEvents).toHaveBeenCalledWith({
      startLedger: 1001,
      endLedger: 1051,
      filters: [
        {
          type: 'contract',
          contractIds: ['CCONTRACT_ABC_123'],
        },
      ],
    });
  });

  it('should ignore P2002 unique constraint violations and continue when encountering already-processed eventIds on restart', async () => {
    prisma.lastIndexedLedger.findUnique.mockResolvedValue({ id: 1, ledger: 1000 });

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('Break indexer loop for test');
    });

    // Mock getEvents returning one event
    const mockEvents = [
      {
        id: 'event-1',
        ledger: 1005,
        topic: ['mint'],
        value: {},
        txHash: 'tx-1',
      },
    ];

    // Mock prisma mint.create throwing P2002 error (duplicate eventId)
    const prismaError = new Error('Unique constraint failed');
    (prismaError as any).code = 'P2002';
    prisma.mint.create.mockRejectedValue(prismaError);

    let count = 0;
    mockGetLatestLedger.mockImplementation(async () => {
      count++;
      if (count > 1) {
        throw new Error('Break indexer loop for test');
      }
      return { sequence: 1050 };
    });

    mockGetEvents.mockResolvedValue({ events: mockEvents });

    try {
      await runIndexer();
    } catch (e: any) {
      expect(e.message).toBe('Break indexer loop for test');
    } finally {
      consoleErrorSpy.mockRestore();
    }

    // Verify mint.create was called with eventId
    expect(prisma.mint.create).toHaveBeenCalledWith({
      data: {
        eventId: 'event-1',
        to: 'recipient-1',
        amount: '1000',
        ledger: 1005,
        txHash: 'tx-1',
      },
    });

    // Verify lastIndexedLedger was still updated because the duplicate event error was caught/ignored
    expect(prisma.lastIndexedLedger.upsert).toHaveBeenCalledWith({
      where: { id: 1 },
      update: { ledger: 1050 },
      create: { id: 1, ledger: 1050 },
    });
  });
});
