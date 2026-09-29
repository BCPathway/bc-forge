/**
 * Pure ledger arithmetic for bc-forge token events.
 *
 * Indexed event amounts and balances are stored as decimal strings because
 * Stellar i128 token amounts can exceed `Number.MAX_SAFE_INTEGER`. This module
 * centralises the BigInt math used both by the indexer to derive holder
 * balances and supply, and by tests to assert those derivations.
 */

export type LedgerEvent =
  | { type: 'mint'; to: string; amount: string }
  | { type: 'transfer'; from: string; to: string; amount: string }
  | { type: 'burn'; from: string; amount: string };

export type LedgerState = {
  balances: Map<string, bigint>;
  supply: bigint;
};

/**
 * Parse a decimal amount/balance string into a BigInt.
 */
export function toBigInt(amount: string): bigint {
  return BigInt(amount);
}

/**
 * Serialize a BigInt amount/balance back into a decimal string.
 */
export function fromBigInt(value: bigint): string {
  return value.toString();
}

/**
 * The signed per-address balance change produced by a single event.
 *
 * - mint:   +amount to `to`
 * - transfer: -amount from `from`, +amount to `to`
 * - burn:   -amount from `from`
 */
export function deltasFor(event: LedgerEvent): Array<{ address: string; delta: bigint }> {
  switch (event.type) {
    case 'mint':
      return [{ address: event.to, delta: toBigInt(event.amount) }];
    case 'burn':
      return [{ address: event.from, delta: -toBigInt(event.amount) }];
    case 'transfer': {
      const amount = toBigInt(event.amount);
      return [
        { address: event.from, delta: -amount },
        { address: event.to, delta: amount },
      ];
    }
  }
}

/**
 * The supply change produced by a single event: mints raise it, burns lower
 * it, and transfers leave it untouched.
 */
export function supplyDeltaFor(event: LedgerEvent): bigint {
  switch (event.type) {
    case 'mint':
      return toBigInt(event.amount);
    case 'burn':
      return -toBigInt(event.amount);
    case 'transfer':
      return 0n;
  }
}

/**
 * An empty ledger state: no balances and zero supply.
 */
export function emptyLedgerState(): LedgerState {
  return { balances: new Map(), supply: 0n };
}

/**
 * Fold one event into an in-memory ledger state in place.
 *
 * A holder whose balance reaches exactly zero is removed from the map, so the
 * map always represents the current set of positive-balance holders.
 */
export function applyLedgerEvent(state: LedgerState, event: LedgerEvent): void {
  for (const { address, delta } of deltasFor(event)) {
    const next = (state.balances.get(address) ?? 0n) + delta;
    if (next === 0n) {
      state.balances.delete(address);
    } else {
      state.balances.set(address, next);
    }
  }
  state.supply += supplyDeltaFor(event);
}

/**
 * Derive the final holder balances and total supply from an input-ordered
 * stream of ledger events. The returned balances map contains exactly the
 * holders with a non-zero balance.
 */
export function foldLedgerEvents(events: LedgerEvent[]): LedgerState {
  const state = emptyLedgerState();
  for (const event of events) {
    applyLedgerEvent(state, event);
  }
  return state;
}