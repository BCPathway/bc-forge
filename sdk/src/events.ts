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
 * Options for event subscriptions.
 */
export interface SubscriptionOptions {
  pollingIntervalMs?: number;
  startLedger?: number;
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
      contractId: event.contractId,
      data: scValToNative(event.value),
    };
  } catch (e) {
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
  } catch (e) {
    return null;
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
  options: SubscriptionOptions = {}
): Promise<() => void> {
  const server = new SorobanRpc.Server(rpcUrl);
  
  // Default to starting from the latest ledger if not specified
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
        filters: [
          {
            contractIds: [contractId],
            type: 'contract',
          },
        ],
      });

      for (const event of response.events) {
        const decoded = decodeEvent(event);
        if (decoded) {
          callback(decoded);
        }
        if (event.ledger >= lastLedger!) {
          lastLedger = event.ledger + 1;
        }
      }
    } catch (err) {
      // Retry in the next poll cycle on failure
    }

    if (active) {
      setTimeout(poll, options.pollingIntervalMs || 3000);
    }
  };

  poll();

  // Return unsubscribe closure
  return () => {
    active = false;
  };
}
