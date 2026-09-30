// SPDX-License-Identifier: MIT
/**
 * Small formatting and parsing helpers shared by the product components.
 *
 * Deliberately free of SDK imports: the leaf components (`TokenCard`,
 * `TransactionToast`, `APYChart`) pull these in, and keeping them dependency
 * free means they neither drag the SDK into a consumer's bundle nor need it
 * mocked in tests. Nothing here touches the protocol — amounts are rendered as
 * text, and the token/vault/APY maths stays in the SDK.
 */

/** An unsigned base-10 integer: no sign, grouping separators or exponent. */
const UNSIGNED_INTEGER = /^\d+$/;

/**
 * Whether `value` is a positive integer written in base 10.
 *
 * Amounts are always submitted to the contract as the smallest indivisible
 * unit, so the product components validate with this rather than accepting
 * decimal input.
 */
export function isPositiveInteger(value: string): boolean {
  return parsePositiveInteger(value) !== null;
}

/**
 * Parses `value` as a base-10 positive integer `bigint`, or returns `null` when
 * it is blank, fractional, signed, or zero.
 */
export function parsePositiveInteger(value: string): bigint | null {
  const trimmed = value.trim();
  if (!UNSIGNED_INTEGER.test(trimmed)) return null;
  const parsed = BigInt(trimmed);
  return parsed > 0n ? parsed : null;
}

export interface FormatTokenAmountOptions {
  /**
   * Drop trailing zeros from the fractional part (and the decimal point when
   * nothing is left). @default true
   */
  trim?: boolean;
  /** Text shown when `amount` is `null` or `undefined`. @default '—' */
  placeholder?: string;
}

/**
 * Renders a raw token amount as a human-readable decimal string.
 *
 * Operates on the `bigint` as a string, so arbitrarily large balances keep
 * every digit — no `Number` conversion, and therefore no precision loss.
 */
export function formatTokenAmount(
  amount: bigint | null | undefined,
  decimals: number | undefined,
  options: FormatTokenAmountOptions = {},
): string {
  const { trim = true, placeholder = '—' } = options;
  if (amount === null || amount === undefined) return placeholder;
  if (decimals === undefined || decimals <= 0) return amount.toString();

  const sign = amount < 0n ? '-' : '';
  const digits = (amount < 0n ? -amount : amount).toString();
  const padded = digits.padStart(decimals + 1, '0');
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);

  if (!trim) return `${sign}${whole}.${fraction}`;
  const trimmedFraction = fraction.replace(/0+$/, '');
  return trimmedFraction ? `${sign}${whole}.${trimmedFraction}` : `${sign}${whole}`;
}

/**
 * Percentage string for a decimal fraction, e.g. `0.1234` -> `'12.34%'`.
 */
export function formatApy(apy: number | null | undefined, fractionDigits = 2): string {
  if (apy === null || apy === undefined || !Number.isFinite(apy)) return '—';
  return `${(apy * 100).toFixed(fractionDigits)}%`;
}

export interface TruncateMiddleOptions {
  /** Leading characters to keep. @default 4 */
  lead?: number;
  /** Trailing characters to keep. @default 4 */
  tail?: number;
  /** Separator inserted in place of the elided characters. @default '…' */
  separator?: string;
}

/**
 * Shortens a long opaque string for display: `'a1b2…z9y8'` from the default
 * four leading and four trailing characters. Values already short enough to
 * show in full are returned unchanged.
 */
export function truncateMiddle(
  value: string,
  { lead = 4, tail = 4, separator = '…' }: TruncateMiddleOptions = {},
): string {
  if (value.length <= lead + tail) return value;
  return `${value.slice(0, lead)}${separator}${value.slice(-tail)}`;
}
