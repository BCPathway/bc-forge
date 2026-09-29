/**
 * @bc-forge/sdk — Event parsing and real-time subscription support.
 */

import { xdr, scValToNative, rpc as SorobanRpc } from '@stellar/stellar-sdk';

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
 * Schema version carried as the last element of every token event data tuple
 * emitted by `contracts/token` and of the vault `deposit`/`withdraw` events
 * emitted by `contracts/wrapper` (#924).
 *
 * Layout (v1) — existing fields keep their positions, the version is
 * appended last:
 * - `mint`:    `[admin, to, amount, new_balance, new_supply, version]`
 * - `burn`:    `[from, amount, new_balance, new_supply, version]`
 * - `xfer`:    `[from, to, amount, version]`
 * - `xfer_frm`: `[spender, from, to, amount, remaining_allowance, version]`
 * - `deposit`: `[caller, assets, shares, version]`
 * - `withdrw`: `[caller, shares, underlying_amount, version]`
 *
 * Tuples without the trailing version are legacy (schema 0) events and are
 * still decoded; `version` is reported as `0` for them.
 */
export const EVENT_SCHEMA_VERSION = 1;

/** Type returned by `scValToNative` for numeric contract fields. */
type Numeric = number | bigint;

/** Data of a `mint` event (schema v1). */
export interface MintEventData {
  version: number;
  admin: string;
  to: string;
  amount: Numeric;
  new_balance: Numeric;
  new_supply: Numeric;
}

/** Data of a `burn` event (schema v1). */
export interface BurnEventData {
  version: number;
  from: string;
  amount: Numeric;
  new_balance: Numeric;
  new_supply: Numeric;
}

/** Data of an `xfer` event (schema v1). */
export interface TransferEventData {
  version: number;
  from: string;
  to: string;
  amount: Numeric;
}

/** Data of an `xfer_frm` event (schema v1). */
export interface TransferFromEventData {
  version: number;
  spender: string;
  from: string;
  to: string;
  amount: Numeric;
  remaining_allowance: Numeric;
}

/** Data of a vault `deposit` event (schema v1). */
export interface DepositEventData {
  version: number;
  caller: string;
  assets: Numeric;
  shares: Numeric;
}

/** Data of a vault `withdrw` event (schema v1). */
export interface WithdrawEventData {
  version: number;
  caller: string;
  shares: Numeric;
  underlying_amount: Numeric;
}

/**
 * Splits an event data tuple into its version and the legacy/typed fields.
 *
 * Returns `null` when `data` is not an array or its length matches neither
 * the versioned layout (fieldCount + 1) nor the legacy layout (fieldCount).
 */
function decodeVersionedTuple(
  data: unknown,
  fieldCount: number
): { fields: unknown[]; version: number } | null {
  if (!Array.isArray(data)) return null;
  if (data.length === fieldCount + 1) {
    return { fields: data, version: Number(data[fieldCount]) };
  }
  if (data.length === fieldCount) {
    // Legacy event emitted before schema versioning (#924).
    return { fields: data, version: 0 };
  }
  return null;
}

function asNumeric(value: unknown): Numeric {
  return value as Numeric;
}

function asString(value: unknown): string {
  return value as string;
}

/** Decodes a `mint` event data tuple into [`MintEventData`]. */
export function decodeMintEventData(data: unknown): MintEventData | null {
  const decoded = decodeVersionedTuple(data, 5);
  if (!decoded) return null;
  const [admin, to, amount, new_balance, new_supply] = decoded.fields;
  return {
    version: decoded.version,
    admin: asString(admin),
    to: asString(to),
    amount: asNumeric(amount),
    new_balance: asNumeric(new_balance),
    new_supply: asNumeric(new_supply),
  };
}

/** Decodes a `burn` event data tuple into [`BurnEventData`]. */
export function decodeBurnEventData(data: unknown): BurnEventData | null {
  const decoded = decodeVersionedTuple(data, 4);
  if (!decoded) return null;
  const [from, amount, new_balance, new_supply] = decoded.fields;
  return {
    version: decoded.version,
    from: asString(from),
    amount: asNumeric(amount),
    new_balance: asNumeric(new_balance),
    new_supply: asNumeric(new_supply),
  };
}

/** Decodes an `xfer` event data tuple into [`TransferEventData`]. */
export function decodeTransferEventData(data: unknown): TransferEventData | null {
  const decoded = decodeVersionedTuple(data, 3);
  if (!decoded) return null;
  const [from, to, amount] = decoded.fields;
  return {
    version: decoded.version,
    from: asString(from),
    to: asString(to),
    amount: asNumeric(amount),
  };
}

/** Decodes an `xfer_frm` event data tuple into [`TransferFromEventData`]. */
export function decodeTransferFromEventData(data: unknown): TransferFromEventData | null {
  const decoded = decodeVersionedTuple(data, 5);
  if (!decoded) return null;
  const [spender, from, to, amount, remaining_allowance] = decoded.fields;
  return {
    version: decoded.version,
    spender: asString(spender),
    from: asString(from),
    to: asString(to),
    amount: asNumeric(amount),
    remaining_allowance: asNumeric(remaining_allowance),
  };
}

/** Decodes a vault `deposit` event data tuple into [`DepositEventData`]. */
export function decodeDepositEventData(data: unknown): DepositEventData | null {
  const decoded = decodeVersionedTuple(data, 3);
  if (!decoded) return null;
  const [caller, assets, shares] = decoded.fields;
  return {
    version: decoded.version,
    caller: asString(caller),
    assets: asNumeric(assets),
    shares: asNumeric(shares),
  };
}

/** Decodes a vault `withdrw` event data tuple into [`WithdrawEventData`]. */
export function decodeWithdrawEventData(data: unknown): WithdrawEventData | null {
  const decoded = decodeVersionedTuple(data, 3);
  if (!decoded) return null;
  const [caller, shares, underlying_amount] = decoded.fields;
  return {
    version: decoded.version,
    caller: asString(caller),
    shares: asNumeric(shares),
    underlying_amount: asNumeric(underlying_amount),
  };
}

/**
 * Structure of a decoded bc-forge event.
 */
export interface bcForgeEvent {
  type: bcForgeEventType;
  ledger: number;
  contractId: string;
  data: unknown;
  txHash?: string;
}

/**
 * Options for event subscriptions and listeners.
 */
export interface SubscriptionOptions {
  pollingIntervalMs?: number;
  startLedger?: number;
}

export interface EventListenerOptions extends SubscriptionOptions {
  server?: SorobanRpc.Server;
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
      txHash: event.txHash ?? (event as any).id,
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
      contractId: event.contractId()
        ? Buffer.from(event.contractId()! as unknown as Uint8Array).toString('hex')
        : '',
      data: scValToNative(body.data()),
    };
  } catch {
    return null;
  }
}

/**
 * Subscribes to real-time events for a given bc-forge contract.
 *
 * @param rpcUrl      - Soroban RPC endpoint
 * @param contractId  - Target contract ID
 * @param callback    - Function called for every new decoded event
 * @param options     - Polling and ledger range options
 * @returns An unsubscribe function to stop polling.
 */
export async function subscribeEvents(
  rpcUrl: string,
  contractId: string,
  callback: (event: bcForgeEvent) => void,
  options: SubscriptionOptions = {},
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
    } catch {
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

/**
 * Poll-based listener for mint events.
 *
 * @param rpcUrl      - Soroban RPC endpoint URL
 * @param contractId  - Deployed contract ID
 * @param callback    - Callback invoked for each new mint event
 * @param options     - Polling interval and starting ledger options
 * @returns Promise resolving to an unsubscribe function to stop polling.
 */
export async function onMint(
  rpcUrl: string,
  contractId: string,
  callback: (event: bcForgeEvent, data: MintEventData) => void,
  options: EventListenerOptions = {},
): Promise<() => void> {
  const server = options.server || new SorobanRpc.Server(rpcUrl);
  let lastLedger = options.startLedger;
  if (lastLedger === undefined) {
    try {
      const latest = await server.getLatestLedger();
      lastLedger = latest.sequence;
    } catch {
      lastLedger = 0;
    }
  }

  const seenTxHashes = new Set<string>();
  let active = true;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (!active) return;
    try {
      const response = await server.getEvents({
        startLedger: lastLedger!,
        filters: [{ contractIds: [contractId], type: 'contract' }],
      });

      for (const eventResponse of response.events) {
        const decoded = decodeEvent(eventResponse);
        if (decoded && decoded.type === bcForgeEventType.MINT) {
          const txHash = decoded.txHash || eventResponse.txHash || eventResponse.id;
          if (txHash && seenTxHashes.has(txHash)) {
            continue;
          }
          if (txHash) {
            seenTxHashes.add(txHash);
          }
          const mintData = decodeMintEventData(decoded.data);
          if (mintData) {
            callback(decoded, mintData);
          }
        }
        if (eventResponse.ledger >= lastLedger!) {
          lastLedger = eventResponse.ledger + 1;
        }
      }
    } catch {
      // Retry on next cycle
    }

    if (active) {
      timerId = setTimeout(poll, options.pollingIntervalMs || 5000);
    }
  };

  poll();

  return () => {
    active = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
}

/**
 * Poll-based listener for transfer events (both xfer and xfer_frm).
 *
 * @param rpcUrl      - Soroban RPC endpoint URL
 * @param contractId  - Deployed contract ID
 * @param callback    - Callback invoked for each new transfer event
 * @param options     - Polling interval and starting ledger options
 * @returns Promise resolving to an unsubscribe function to stop polling.
 */
export async function onTransfer(
  rpcUrl: string,
  contractId: string,
  callback: (event: bcForgeEvent, data: TransferEventData | TransferFromEventData) => void,
  options: EventListenerOptions = {},
): Promise<() => void> {
  const server = options.server || new SorobanRpc.Server(rpcUrl);
  let lastLedger = options.startLedger;
  if (lastLedger === undefined) {
    try {
      const latest = await server.getLatestLedger();
      lastLedger = latest.sequence;
    } catch {
      lastLedger = 0;
    }
  }

  const seenTxHashes = new Set<string>();
  let active = true;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (!active) return;
    try {
      const response = await server.getEvents({
        startLedger: lastLedger!,
        filters: [{ contractIds: [contractId], type: 'contract' }],
      });

      for (const eventResponse of response.events) {
        const decoded = decodeEvent(eventResponse);
        if (
          decoded &&
          (decoded.type === bcForgeEventType.TRANSFER ||
            decoded.type === bcForgeEventType.TRANSFER_FROM)
        ) {
          const txHash = decoded.txHash || eventResponse.txHash || eventResponse.id;
          if (txHash && seenTxHashes.has(txHash)) {
            continue;
          }
          if (txHash) {
            seenTxHashes.add(txHash);
          }
          if (decoded.type === bcForgeEventType.TRANSFER) {
            const data = decodeTransferEventData(decoded.data);
            if (data) callback(decoded, data);
          } else {
            const data = decodeTransferFromEventData(decoded.data);
            if (data) callback(decoded, data);
          }
        }
        if (eventResponse.ledger >= lastLedger!) {
          lastLedger = eventResponse.ledger + 1;
        }
      }
    } catch {
      // Retry on next cycle
    }

    if (active) {
      timerId = setTimeout(poll, options.pollingIntervalMs || 5000);
    }
  };

  poll();

  return () => {
    active = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
}

/**
 * Poll-based listener for vault deposit events.
 *
 * @param rpcUrl      - Soroban RPC endpoint URL
 * @param contractId  - Deployed vault / wrapper contract ID
 * @param callback    - Callback invoked for each new vault deposit event
 * @param options     - Polling interval and starting ledger options
 * @returns Promise resolving to an unsubscribe function to stop polling.
 */
export async function onVaultDeposit(
  rpcUrl: string,
  contractId: string,
  callback: (event: bcForgeEvent, data: DepositEventData) => void,
  options: EventListenerOptions = {},
): Promise<() => void> {
  const server = options.server || new SorobanRpc.Server(rpcUrl);
  let lastLedger = options.startLedger;
  if (lastLedger === undefined) {
    try {
      const latest = await server.getLatestLedger();
      lastLedger = latest.sequence;
    } catch {
      lastLedger = 0;
    }
  }

  const seenTxHashes = new Set<string>();
  let active = true;
  let timerId: ReturnType<typeof setTimeout> | null = null;

  const poll = async () => {
    if (!active) return;
    try {
      const response = await server.getEvents({
        startLedger: lastLedger!,
        filters: [{ contractIds: [contractId], type: 'contract' }],
      });

      for (const eventResponse of response.events) {
        let topicSymbol: string | undefined;
        if (eventResponse.topic && eventResponse.topic.length > 0) {
          try {
            topicSymbol = scValToNative(eventResponse.topic[0]) as string;
          } catch {
            // ignore
          }
        }

        if (topicSymbol === 'deposit') {
          const txHash = eventResponse.txHash || eventResponse.id;
          if (txHash && seenTxHashes.has(txHash)) {
            continue;
          }
          if (txHash) {
            seenTxHashes.add(txHash);
          }
          const data = decodeDepositEventData(scValToNative(eventResponse.value));
          if (data) {
            const synthEvent: bcForgeEvent = {
              type: 'deposit' as bcForgeEventType,
              ledger: eventResponse.ledger,
              contractId: eventResponse.contractId?.toString() ?? contractId,
              data: scValToNative(eventResponse.value),
              txHash,
            };
            callback(synthEvent, data);
          }
        }
        if (eventResponse.ledger >= lastLedger!) {
          lastLedger = eventResponse.ledger + 1;
        }
      }
    } catch {
      // Retry on next cycle
    }

    if (active) {
      timerId = setTimeout(poll, options.pollingIntervalMs || 5000);
    }
  };

  poll();

  return () => {
    active = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
}
