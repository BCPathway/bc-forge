/**
 * @bc-forge/sdk — Event parsing and real-time subscription support.
 */

import { xdr, scValToNative, SorobanRpc } from '@stellar/stellar-sdk';

/**
 * Enumeration of all supported bc-forge contract events.
 */
export enum bcForgeEventType {
  INITIALIZED = 'init',
  MINT = 'mint',
  BURN = 'burn',
  TRANSFER = 'xfer',
  TRANSFER_FROM = 'xfer_frm',
  APPROVE = 'approve',
  OWNERSHIP_TRANSFERRED = 'own_xfer',
  PAUSED = 'paused',
  UNPAUSED = 'unpause',
  CLAWBACK = 'clawback',
  LOCKED = 'lock',
  WITHDRAW_LOCKED = 'unlock',
}

/**
 * Structure of a decoded bc-forge event.
 */
export interface bcForgeEvent {
  type: bcForgeEventType;
  ledger: number;
  contractId: string;
  data: any;
}

/**
 * Event filter for filtering events.
 */
export interface EventFilter {
  contractIds?: string[];
  eventTypes?: bcForgeEventType[];
  startLedger?: number;
  endLedger?: number;
}

/**
 * Options for event subscriptions.
 */
export interface SubscriptionOptions {
  pollingIntervalMs?: number;
  startLedger?: number;
  maxRetryAttempts?: number;
  retryDelayMs?: number;
}

/**
 * Decodes a standard Soroban RPC event into a native bcForgeEvent.
 */
export function decodeEvent(event: SorobanRpc.Api.EventResponse): bcForgeEvent | null {
  if (!event.topic || event.topic.length === 0) return null;

  try {
    const topicSymbol = scValToNative(event.topic[0]);
    const type = Object.values(bcForgeEventType).find((t) => t === topicSymbol) as bcForgeEventType;

    if (!type) return null;

    return {
      type,
      ledger: event.ledger,
      contractId: event.contractId?.toString() ?? '',
      data: scValToNative(event.value),
    };
  } catch {
    return null;
  }
}

/**
 * Decodes raw diagnostic events (often found in transaction results) into bcForgeEvents.
 */
export function decodeDiagnosticEvent(rawEvent: xdr.DiagnosticEvent): bcForgeEvent | null {
  const event = rawEvent.event();
  if (event.type().name !== 'contract') return null;

  const body = event.body().v0();
  const topics = body.topics();
  if (topics.length === 0) return null;

  try {
    const topicSymbol = scValToNative(topics[0]);
    const type = Object.values(bcForgeEventType).find((t) => t === topicSymbol) as bcForgeEventType;

    if (!type) return null;

    return {
      type,
      ledger: 0, // Diagnostic events don't always carry ledger sequence
      contractId: event.contractId()?.toString('hex') || '',
      data: scValToNative(body.data()),
    };
  } catch {
    return null;
  }
}

/**
 * EventParser class for parsing Soroban events into bcForgeEvent objects.
 */
export class EventParser {
  /**
   * Parses raw event responses into bcForgeEvent objects.
   * @param events Raw Soroban event responses.
   * @returns Array of parsed bcForgeEvent objects, filtering out invalid ones.
   */
  parseEvents(events: SorobanRpc.Api.EventResponse[]): bcForgeEvent[] {
    return events.map((event) => decodeEvent(event)).filter((e): e is bcForgeEvent => e !== null);
  }

  /**
   * Parses a single event response into a bcForgeEvent object.
   * @param event Raw Soroban event response.
   * @returns Parsed bcForgeEvent or null if invalid.
   */
  parseEvent(event: SorobanRpc.Api.EventResponse): bcForgeEvent | null {
    return decodeEvent(event);
  }

  /**
   * Parses diagnostic events into bcForgeEvent objects.
   * @param rawEvents Array of raw xdr.DiagnosticEvent.
   * @returns Array of parsed bcForgeEvent objects.
   */
  parseDiagnosticEvents(rawEvents: xdr.DiagnosticEvent[]): bcForgeEvent[] {
    return rawEvents
      .map((event) => decodeDiagnosticEvent(event))
      .filter((e): e is bcForgeEvent => e !== null);
  }
}

/**
 * EventStream class for managing real-time event subscriptions.
 */
export class EventStream {
  private rpcUrl: string;
  private server: SorobanRpc.Server;
  private contractId: string;
  private filter: EventFilter;
  private options: SubscriptionOptions;
  private active: boolean = false;
  private lastLedger: number | null = null;
  private pollTimeout: NodeJS.Timeout | null = null;
  private retryCount: number = 0;
  private callback: ((event: bcForgeEvent) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private parser: EventParser;

  constructor(
    rpcUrl: string,
    contractId: string,
    filter: EventFilter = {},
    options: SubscriptionOptions = {},
  ) {
    this.rpcUrl = rpcUrl;
    this.server = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
    this.filter = filter;
    this.options = {
      pollingIntervalMs: 3000,
      maxRetryAttempts: 5,
      retryDelayMs: 1000,
      ...options,
    };
    this.parser = new EventParser();
  }

  /**
   * Subscribes to real-time events.
   * @param callback Function called for every new decoded event.
   */
  async subscribe(callback: (event: bcForgeEvent) => void): Promise<void> {
    if (this.active) {
      throw new Error('Already subscribed');
    }

    this.active = true;
    this.callback = callback;
    this.retryCount = 0;

    // Initialize lastLedger
    if (this.filter.startLedger) {
      this.lastLedger = this.filter.startLedger;
    } else if (this.options.startLedger) {
      this.lastLedger = this.options.startLedger;
    } else {
      const latest = await this.server.getLatestLedger();
      this.lastLedger = latest.sequence;
    }

    await this.poll();
  }

  /**
   * Unsubscribes from real-time events.
   */
  unsubscribe(): void {
    this.active = false;
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  /**
   * Registers an error callback for stream errors.
   * @param callback Function called when an error occurs.
   */
  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  private async poll(): Promise<void> {
    if (!this.active || !this.lastLedger) return;

    try {
      const rpcFilters: SorobanRpc.Api.EventFilter[] = [
        {
          contractIds: this.filter.contractIds || [this.contractId],
          type: 'contract',
        },
      ];

      const response = await this.server.getEvents({
        startLedger: this.lastLedger,
        filters: rpcFilters,
      });

      this.retryCount = 0;

      const parsedEvents = this.parser.parseEvents(response.events);
      for (const event of parsedEvents) {
        // Apply filter
        if (this.matchesFilter(event)) {
          this.callback?.(event);
        }
        if (event.ledger >= this.lastLedger!) {
          this.lastLedger = event.ledger + 1;
        }
      }

      // If no events, just increment lastLedger to avoid re-polling the same ledger
      if (response.events.length === 0 && response.latestLedger) {
        this.lastLedger = response.latestLedger + 1;
      }
    } catch (error) {
      this.retryCount++;
      if (this.retryCount <= (this.options.maxRetryAttempts || 5)) {
        const delay = (this.options.retryDelayMs || 1000) * this.retryCount;
        this.errorCallback?.(
          new Error(`Poll failed (attempt ${this.retryCount}), retrying in ${delay}ms`),
        );
        this.pollTimeout = setTimeout(() => this.poll(), delay);
        return;
      } else {
        this.active = false;
        this.errorCallback?.(new Error('Max retry attempts exceeded, stopping stream'));
        return;
      }
    }

    if (this.active) {
      this.pollTimeout = setTimeout(() => this.poll(), this.options.pollingIntervalMs || 3000);
    }
  }

  private matchesFilter(event: bcForgeEvent): boolean {
    // Check event type filter
    if (this.filter.eventTypes && this.filter.eventTypes.length > 0) {
      if (!this.filter.eventTypes.includes(event.type)) {
        return false;
      }
    }

    // Check end ledger filter
    if (this.filter.endLedger && event.ledger > this.filter.endLedger) {
      return false;
    }

    return true;
  }
}

/**
 * Subscribes to real-time events for a given bc-forge contract.
 *
 * @param rpcUrl      - Soroban RPC endpoint
 * @param contractId  - Target contract ID
 * @param callback    - Function called for every new decoded event
 * @param options     - Polking and ledger range options
 * @returns An unsubscribe function to stop polling.
 */
export async function subscribeEvents(
  rpcUrl: string,
  contractId: string,
  callback: (event: bcForgeEvent) => void,
  options: SubscriptionOptions = {},
): Promise<() => void> {
  const stream = new EventStream(rpcUrl, contractId, {}, options);
  await stream.subscribe(callback);
  return () => stream.unsubscribe();
}
