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

/** A finite, non-negative integer. */
function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Whether `value` is a positive integer written in base 10.
 *
 * Amounts are always submitted to the contract as the smallest indivisible
 * unit, so product components validate with this rather than accepting decimal
 * input.
 */
export function isPositiveInteger(value: string): boolean {
  return parsePositiveInteger(value) !== null;
}

/**
 * Parses `value` as a base-10 positive integer `bigint`, or returns `null` when
 * it is blank, fractional, signed, or zero.
 *
 * Leading/trailing whitespace is ignored. Leading zeros are accepted.
 */
export function parsePositiveInteger(value: string): bigint | null {
  const trimmed = value.trim();

  if (!UNSIGNED_INTEGER.test(trimmed)) {
    return null;
  }

  try {
    const parsed = BigInt(trimmed);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export interface FormatTokenAmountOptions {
  /**
   * Drop trailing zeros from the fractional part (and the decimal point when
   * nothing is left).
   *
   * @default true
   */
  trim?: boolean;

  /**
   * Text shown when `amount` is `null` or `undefined`.
   *
   * @default '—'
   */
  placeholder?: string;
}

/**
 * Renders a raw token amount as a human-readable decimal string.
 *
 * Operates on the `bigint` as a string, so arbitrarily large balances keep
 * every digit — no `Number` conversion, and therefore no precision loss.
 *
 * `decimals` represents the token's fractional precision. Invalid decimal
 * values (negative, fractional, or non-finite values) fall back to displaying
 * the raw integer amount.
 *
 * Examples:
 * - `formatTokenAmount(123456n, 2)` => `"1234.56"`
 * - `formatTokenAmount(1000n, 3)` => `"1"`
 * - `formatTokenAmount(-123456n, 2)` => `"-1234.56"`
 * - `formatTokenAmount(1000n, 3, { trim: false })` => `"1.000"`
 */
export function formatTokenAmount(
  amount: bigint | null | undefined,
  decimals: number | undefined,
  options: FormatTokenAmountOptions = {},
): string {
  const { trim = true, placeholder = "—" } = options;

  if (amount === null || amount === undefined) {
    return placeholder;
  }

  if (
    decimals === undefined ||
    !isNonNegativeInteger(decimals) ||
    decimals === 0
  ) {
    return amount.toString();
  }

  const sign = amount < 0n ? "-" : "";
  const absoluteAmount = amount < 0n ? -amount : amount;
  const digits = absoluteAmount.toString();

  // Ensure there is at least one digit before the decimal point.
  const padded = digits.padStart(decimals + 1, "0");

  const splitIndex = padded.length - decimals;
  const whole = padded.slice(0, splitIndex);
  const fraction = padded.slice(splitIndex);

  if (!trim) {
    return `${sign}${whole}.${fraction}`;
  }

  const trimmedFraction = fraction.replace(/0+$/, "");

  return trimmedFraction.length > 0
    ? `${sign}${whole}.${trimmedFraction}`
    : `${sign}${whole}`;
}

/**
 * Percentage string for a decimal fraction, e.g. `0.1234` -> `'12.34%'`.
 *
 * Invalid precision falls back to the default of 2 decimal places.
 * Non-finite APY values return the placeholder.
 */
export function formatApy(
  apy: number | null | undefined,
  fractionDigits = 2,
): string {
  if (apy === null || apy === undefined || !Number.isFinite(apy)) {
    return "—";
  }

  const safeFractionDigits = Number.isInteger(fractionDigits)
    ? Math.min(Math.max(fractionDigits, 0), 100)
    : 2;

  return `${(apy * 100).toFixed(safeFractionDigits)}%`;
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
 * Shortens a long opaque string for display.
 *
 * Example:
 * `truncateMiddle("a1b2c3d4z9y8")` => `"a1b2…z9y8"`
 *
 * Values already short enough to display in full are returned unchanged.
 * If the requested leading/trailing lengths are invalid, they fall back
 * to 4 characters each.
 */
export function truncateMiddle(
  value: string,
  { lead = 4, tail = 4, separator = "…" }: TruncateMiddleOptions = {},
): string {
  const safeLead = isNonNegativeInteger(lead) ? lead : 4;
  const safeTail = isNonNegativeInteger(tail) ? tail : 4;

  if (value.length <= safeLead + safeTail) {
    return value;
  }

  if (safeLead === 0 && safeTail === 0) {
    return separator;
  }

  const leading = value.slice(0, safeLead);
  const trailing = safeTail > 0 ? value.slice(-safeTail) : "";

  return `${leading}${separator}${trailing}`;
}

/**
 * Known error patterns and their user-friendly descriptions.
 */
const WALLET_ERROR_PATTERNS: Array<{
  test: (msg: string) => boolean;
  message: string;
}> = [
  {
    // Matches Freighter, Albedo, and standard wallet rejection messages:
    // "User declined", "User rejected", "User cancelled", "transaction was rejected", etc.
    test: (msg) =>
      /user\s*(declined|rejected|cancelled|canceled|denied)/i.test(msg) ||
      /transaction\s*(was\s*)?(declined|rejected|cancelled|canceled)/i.test(
        msg,
      ) ||
      /rejected\s*by\s*user/i.test(msg) ||
      /declined\s*by\s*user/i.test(msg) ||
      /signature\s*rejected/i.test(msg) ||
      /request\s*rejected/i.test(msg),
    message: "Transaction cancelled by user",
  },
  {
    test: (msg) =>
      /not\s*connected|disconnected|no\s*wallet\s*connected|unauthenticated/i.test(
        msg,
      ),
    message: "Wallet is not connected. Please connect your wallet first.",
  },
  {
    test: (msg) =>
      /wrong\s*network|different\s*stellar\s*network|network\s*mismatch/i.test(
        msg,
      ),
    message:
      "Wallet is connected to a different Stellar network than expected.",
  },
  {
    test: (msg) =>
      /timeout|timed\s*out|network\s*error|econnrefused|failed\s*to\s*fetch/i.test(
        msg,
      ),
    message:
      "Network request timed out or failed. Please check your connection and try again.",
  },
  {
    test: (msg) =>
      /hardware\s*wallet|ledger.*(timed?\s*out|disconnected)/i.test(msg),
    message:
      "Hardware wallet confirmation timed out or device was disconnected.",
  },
];

/**
 * Extracts a readable message from an unknown thrown value.
 *
 * Handles Error instances, strings, object-like errors with a `message`
 * property, and arbitrary thrown values without throwing itself.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;

    if (typeof message === "string") {
      return message;
    }

    if (message !== null && message !== undefined) {
      try {
        return String(message);
      } catch {
        return "";
      }
    }
  }

  try {
    return String(error);
  } catch {
    return "";
  }
}

/**
 * Parses arbitrary wallet, signature, network, and RPC errors into friendly UI
 * descriptions.
 *
 * Intercepts user signature rejections (e.g. from Freighter, Albedo, or Ledger)
 * and converts them to "Transaction cancelled by user".
 *
 * @param error - The caught error object, message string, or unknown thrown exception.
 * @returns Human-readable, actionable error message suitable for toasts and alert dialogs.
 */
export function parseWalletError(error: unknown): string {
  if (error === null || error === undefined) {
    return "An unexpected error occurred.";
  }

  const rawMessage = getErrorMessage(error);
  const trimmed = rawMessage.trim();

  if (!trimmed) {
    return "An unexpected error occurred.";
  }

  for (const { test, message } of WALLET_ERROR_PATTERNS) {
    if (test(trimmed)) {
      return message;
    }
  }

  return trimmed;
}

export type RbacReportFormat = "csv" | "json";

/**
 * Serializes JSON report values while converting BigInt values into strings.
 *
 * Undefined values follow JSON.stringify's normal behavior. Circular references
 * are not supported and will still throw.
 */
const stringifyReportValue = (value: unknown, space?: number): string =>
  JSON.stringify(
    value,
    (_key, nestedValue: unknown) =>
      typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
    space,
  );

/**
 * Escapes a CSV field and mitigates spreadsheet formula injection.
 *
 * Formula-like cells beginning with =, +, -, or @ are prefixed with an
 * apostrophe before CSV escaping is applied.
 */
function escapeCsvCell(value: string): string {
  const safeValue = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
}

/** Creates a timestamped role assignment and audit-history download. */
export function exportRbacReport(
  address: string,
  roles: Record<string, boolean>,
  auditHistory: unknown[],
  format: RbacReportFormat,
  exportedAt = new Date().toISOString(),
): { filename: string; mimeType: string; content: string } {
  const timestamp = exportedAt.replace(/[:.]/g, "-");

  if (format === "json") {
    return {
      filename: `rbac-report-${timestamp}.json`,
      mimeType: "application/json",
      content: stringifyReportValue(
        {
          exportedAt,
          roleAssignments: [{ address, roles }],
          auditHistory,
        },
        2,
      ),
    };
  }

  const rows: string[][] = Object.entries(roles).map(([role, granted]) => [
    "role",
    address,
    role,
    String(granted),
    "",
  ]);

  for (const event of auditHistory) {
    rows.push(["audit", "", "", "", stringifyReportValue(event)]);
  }

  const headers = ["kind", "address", "role", "granted", "event"];

  return {
    filename: `rbac-report-${timestamp}.csv`,
    mimeType: "text/csv",
    content: [headers, ...rows]
      .map((row) => row.map(escapeCsvCell).join(","))
      .join("\r\n"),
  };
}