/**
 * @bc-forge/sdk — Tests for EventParser and EventStream classes
 */

import { EventParser, EventStream, bcForgeEventType, bcForgeEvent } from './events';
import { SorobanRpc, scValToNative, nativeToScVal } from '@stellar/stellar-sdk';

// Mock SorobanRpc.Server
jest.mock('@stellar/stellar-sdk', () => {
  const original = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...original,
    SorobanRpc: {
      ...original.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        getLatestLedger: jest.fn(),
        getEvents: jest.fn(),
      })),
    },
  };
});

describe('EventParser', () => {
  let parser: EventParser;

  beforeEach(() => {
    parser = new EventParser();
  });

  describe('parseEvent', () => {
    it('should parse valid event correctly', () => {
      const mockEvent = {
        topic: [nativeToScVal('mint')],
        ledger: 12345,
        contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
        value: nativeToScVal({ amount: 100, to: 'GABC123' }),
      } as unknown as SorobanRpc.Api.EventResponse;

      const result = parser.parseEvent(mockEvent);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.type).toBe(bcForgeEventType.MINT);
        expect(result.ledger).toBe(12345);
        expect(result.contractId).toBe('CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526');
      }
    });

    it('should return null for invalid event type', () => {
      const mockEvent = {
        topic: [nativeToScVal('invalid-type')],
        ledger: 12345,
        contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
        value: nativeToScVal({}),
      } as unknown as SorobanRpc.Api.EventResponse;

      const result = parser.parseEvent(mockEvent);
      expect(result).toBeNull();
    });

    it('should return null for event without topic', () => {
      const mockEvent = {
        topic: [],
        ledger: 12345,
        contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
        value: nativeToScVal({}),
      } as unknown as SorobanRpc.Api.EventResponse;

      const result = parser.parseEvent(mockEvent);
      expect(result).toBeNull();
    });
  });

  describe('parseEvents', () => {
    it('should parse multiple events and filter out invalid ones', () => {
      const mockEvents = [
        {
          topic: [nativeToScVal('mint')],
          ledger: 12345,
          contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
          value: nativeToScVal({ amount: 100, to: 'GABC123' }),
        },
        {
          topic: [nativeToScVal('invalid-type')],
          ledger: 12346,
          contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
          value: nativeToScVal({}),
        },
        {
          topic: [nativeToScVal('xfer')],
          ledger: 12347,
          contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
          value: nativeToScVal({ from: 'GABC123', to: 'GDEF456', amount: 50 }),
        },
      ] as unknown as SorobanRpc.Api.EventResponse[];

      const results = parser.parseEvents(mockEvents);
      expect(results).toHaveLength(2);
      expect(results[0].type).toBe(bcForgeEventType.MINT);
      expect(results[1].type).toBe(bcForgeEventType.TRANSFER);
    });
  });
});

describe('EventStream', () => {
  let mockServer: any;
  let eventStream: EventStream;

  beforeEach(() => {
    mockServer = {
      getLatestLedger: jest.fn().mockResolvedValue({ sequence: 1000 }),
      getEvents: jest.fn(),
    };
    (SorobanRpc.Server as jest.Mock).mockImplementation(() => mockServer);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('subscribe and unsubscribe', () => {
    it('should subscribe and call callback on new events', async () => {
      const callback = jest.fn();
      const mockEvents = [
        {
          topic: [nativeToScVal('mint')],
          ledger: 1001,
          contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
          value: nativeToScVal({ amount: 100, to: 'GABC123' }),
        },
      ] as unknown as SorobanRpc.Api.EventResponse[];
      mockServer.getEvents.mockResolvedValue({
        events: mockEvents,
        latestLedger: 1001,
      });

      eventStream = new EventStream('https://mock.rpc', 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526');
      await eventStream.subscribe(callback);
      // Fast-forward time to trigger poll
      jest.runAllTimers();
      // Wait for promises to resolve
      await Promise.resolve();
      
      expect(callback).toHaveBeenCalled();
    });

    it('should unsubscribe and stop calling callback', async () => {
      const callback = jest.fn();
      eventStream = new EventStream('https://mock.rpc', 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526');
      await eventStream.subscribe(callback);
      eventStream.unsubscribe();
      
      mockServer.getEvents.mockResolvedValue({
        events: [],
        latestLedger: 1001,
      });
      
      jest.runAllTimers();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('error handling and auto-reconnect', () => {
    it('should call error callback on poll failure and retry', async () => {
      const errorCallback = jest.fn();
      const callback = jest.fn();
      mockServer.getEvents.mockRejectedValue(new Error('RPC failed'));
      
      eventStream = new EventStream('https://mock.rpc', 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526');
      eventStream.onError(errorCallback);
      await eventStream.subscribe(callback);
      
      jest.runAllTimers();
      await Promise.resolve();
      
      expect(errorCallback).toHaveBeenCalled();
    });
  });

  describe('filtering', () => {
    it('should only emit events matching filter', async () => {
      const callback = jest.fn();
      const mockEvents = [
        {
          topic: [nativeToScVal('mint')],
          ledger: 1001,
          contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
          value: nativeToScVal({ amount: 100, to: 'GABC123' }),
        },
        {
          topic: [nativeToScVal('xfer')],
          ledger: 1002,
          contractId: 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
          value: nativeToScVal({ from: 'GABC123', to: 'GDEF456', amount: 50 }),
        },
      ] as unknown as SorobanRpc.Api.EventResponse[];
      mockServer.getEvents.mockResolvedValue({
        events: mockEvents,
        latestLedger: 1002,
      });

      eventStream = new EventStream(
        'https://mock.rpc',
        'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526',
        { eventTypes: [bcForgeEventType.MINT] }
      );
      
      await eventStream.subscribe(callback);
      jest.runAllTimers();
      await Promise.resolve();
      
      expect(callback).toHaveBeenCalledTimes(1);
      const event = callback.mock.calls[0][0];
      expect(event.type).toBe(bcForgeEventType.MINT);
    });
  });
});
