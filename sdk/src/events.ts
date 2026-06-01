// @bc-forge/sdk — Event parsing and real-time subscription support.

import { xdr, scValToNative, SorobanRpc } from '@stellar/stellar-sdk';

/** Enumeration of all supported bc-forge contract events. */
export enum bcForgeEventType {
  INITIALIZED = 'initialized',
  MINT = 'mint',
  BURN = 'burn',
  TRANSFER = 'transfer',
  TRANSFER_FROM = 'transfer_from',
  APPROVE = 'approve',
  OWNERSHIP_TRANSFERRED = 'ownership_transferred',
  PAUSED = 'paused',
  UNPAUSED = 'unpaused',
  CLAWBACK = 'clawback',
  LOCKED = 'locked',
  SNAPSHOT_CREATED = 'snapshot_created',
  UPGRADE = 'upgrade',
  UPDATE_NAME = 'update_name',
  UPDATE_SYMBOL = 'update_symbol',
}

/** Header data accompanying each event, following the contract's versioned schema. */
export interface EventHeader {
  contractSymbol: string;
  eventName: bcForgeEventType;
  version: number;
  ledgerSeq: number;
  timestamp: number;
  txHash: string;
}

/** Fully decoded event with header and payload. */
export interface DecodedEvent {
  header: EventHeader;
  payload: any;
}

/** Options for event subscription polling. */
export interface SubscriptionOptions {
  pollingIntervalMs?: number; // interval between polls (default 3000ms)
  startLedger?: number; // ledger to start from; defaults to latest
}

/** Decode a standard Soroban RPC event into a version‑aware DecodedEvent. */
export function decodeEvent(event: SorobanRpc.Api.EventResponse): DecodedEvent | null {
  if (!event.topic || event.topic.length < 6) return null;

  try {
    const contractSymbol = scValToNative(event.topic[0]);
    const eventNameStr = scValToNative(event.topic[1]);
    const version = Number(scValToNative(event.topic[2]));
    const ledgerSeq = Number(scValToNative(event.topic[3]));
    const timestamp = Number(scValToNative(event.topic[4]));
    const txHash = scValToNative(event.topic[5]);

    const eventName = Object.values(bcForgeEventType).find((t) => t === eventNameStr) as bcForgeEventType;
    if (!eventName) return null;

    const header: EventHeader = {
      contractSymbol,
      eventName,
      version,
      ledgerSeq,
      timestamp,
      txHash,
    };

    const payload = scValToNative(event.value);
    return { header, payload };
  } catch {
    return null;
  }
}

/** Decode a diagnostic event (from transaction simulation) similarly. */
export function decodeDiagnosticEvent(rawEvent: xdr.DiagnosticEvent): DecodedEvent | null {
  const event = rawEvent.event();
  if (event.type().name !== 'contract') return null;
  const body = event.body().v0();
  const topics = body.topics();
  if (topics.length < 6) return null;

  try {
    const contractSymbol = scValToNative(topics[0]);
    const eventNameStr = scValToNative(topics[1]);
    const version = Number(scValToNative(topics[2]));
    const ledgerSeq = Number(scValToNative(topics[3]));
    const timestamp = Number(scValToNative(topics[4]));
    const txHash = scValToNative(topics[5]);

    const eventName = Object.values(bcForgeEventType).find((t) => t === eventNameStr) as bcForgeEventType;
    if (!eventName) return null;

    const header: EventHeader = {
      contractSymbol,
      eventName,
      version,
      ledgerSeq,
      timestamp,
      txHash,
    };

    const payload = scValToNative(body.data());
    return { header, payload };
  } catch {
    return null;
  }
}

/** Subscribe to real‑time contract events with optional polling. */
export async function subscribeEvents(
  rpcUrl: string,
  contractId: string,
  callback: (event: DecodedEvent) => void,
  options: SubscriptionOptions = {}
): Promise<() => void> {
  const server = new SorobanRpc.Server(rpcUrl);

  // Determine starting ledger
  let lastLedger = options.startLedger;
  if (!lastLedger) {
    const latest = await server.getLatestLedger();
    lastLedger = latest.sequence;
  }

  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const response = await server.getEvents({
        startLedger: lastLedger!,
        filters: [{ contractIds: [contractId], type: 'contract' }],
      });
      for (const ev of response.events) {
        const decoded = decodeEvent(ev);
        if (decoded) callback(decoded);
        if (ev.ledger >= lastLedger!) {
          lastLedger = ev.ledger + 1;
        }
      }
    } catch {
      // swallow errors; next poll will retry
    }
    if (active) {
      setTimeout(poll, options.pollingIntervalMs || 3000);
    }
  };

  poll();
  return () => {
    active = false;
  };
}
