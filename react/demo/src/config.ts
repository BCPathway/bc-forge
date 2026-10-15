// SPDX-License-Identifier: MIT
import { z } from 'zod';

// ─── Environment validation (#1146) ─────────────────────────────────────────

/**
 * Shape of a Stellar contract id: a `C` version byte followed by 55 base32
 * characters (`C…`, 56 in total).
 */
export const CONTRACT_ID_PATTERN = /^C[A-Z0-9]{55}$/;

/** Absolute `http(s)` URL with a host, used for the Soroban RPC endpoint. */
const HTTP_URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/** Soroban RPC endpoint used when `VITE_RPC_URL` is not set. */
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org';

/** Passphrase used when `VITE_NETWORK_PASSPHRASE` is not set. */
export const DEFAULT_NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Contract id used when `VITE_CONTRACT_ID` is not set. */
export const DEFAULT_CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM';

// Validations are expressed as `refine` predicates so the schema stays
// readable and the screen can own the wording; zod supplies the structure,
// these supply the developer-facing message.
const rpcUrlSchema = z
  .string()
  .refine(
    (value) => HTTP_URL_PATTERN.test(value.trim()),
    'must be an absolute http(s) URL such as https://soroban-testnet.stellar.org',
  );

const passphraseSchema = z
  .string()
  .refine((value) => value.trim().length > 0, 'must not be blank');

const contractIdSchema = z
  .string()
  .refine(
    (value) => CONTRACT_ID_PATTERN.test(value.trim()),
    'must be a Stellar contract id: C followed by 55 uppercase base32 characters',
  );

const demoEnvSchema = z.object({
  VITE_RPC_URL: rpcUrlSchema,
  VITE_NETWORK_PASSPHRASE: passphraseSchema,
  VITE_CONTRACT_ID: contractIdSchema,
});

/** Raw environment bag, shaped like Vite's `import.meta.env`. */
export type RawEnv = Record<string, string | boolean | undefined>;

/** One problem found while validating the demo's environment. */
export interface ConfigIssue {
  /** Environment variable the problem belongs to, or `'(env)'` when unknown. */
  field: string;
  /** What is wrong with the value. */
  message: string;
  /** The value that was read, when there was one. */
  received?: string;
  /** The shape the value has to have. */
  expected?: string;
  /** How to fix it. */
  hint?: string;
}

/** Validated demo configuration, ready to hand to `BcForgeProvider`. */
export interface DemoConfig {
  /** Soroban RPC endpoint. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
  /** Deployed token / vault contract id. */
  contractId: string;
  /** Pre-filled wallet address, or `undefined` when not configured. */
  walletAddress: string | undefined;
}

/** Discriminated result of {@link loadConfig}. */
export type ConfigResult =
  | { ok: true; config: DemoConfig }
  | { ok: false; issues: ConfigIssue[] };

/** Copy-pasteable `.env` shown alongside the configuration errors. */
export const ENV_TEMPLATE = `# react/demo/.env
VITE_RPC_URL=${DEFAULT_RPC_URL}
VITE_NETWORK_PASSPHRASE=${DEFAULT_NETWORK_PASSPHRASE}
VITE_CONTRACT_ID=${DEFAULT_CONTRACT_ID}
# VITE_WALLET_ADDRESS=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
`;

/** What each variable must look like, and how to fix it. */
const FIELD_HELP: Record<string, { expected: string; hint: string }> = {
  VITE_RPC_URL: {
    expected: 'An absolute http(s) URL, e.g. https://soroban-testnet.stellar.org',
    hint: 'Point VITE_RPC_URL at the Soroban RPC endpoint the demo should talk to. ' +
      'Local: http://localhost:8000. Restart `npm run dev` after editing .env.',
  },
  VITE_NETWORK_PASSPHRASE: {
    expected: 'A non-empty passphrase, e.g. Test SDF Network ; September 2015',
    hint: 'Copy the passphrase verbatim, including the trailing date. It must match ' +
      'VITE_RPC_URL and the network the wallet extension is on.',
  },
  VITE_CONTRACT_ID: {
    expected: 'A Stellar contract id: C followed by 55 uppercase base32 characters',
    hint: 'Deploy the token contract and paste the printed contract id here. ' +
      'See deployments/ and the contract README for the deploy command.',
  },
};

/** Structural view of a zod issue, so the mapper needs no zod type import. */
interface RawIssue {
  path: PropertyKey[];
  message: string;
}

/** Reads `key` from the environment, falling back to `fallback` when unset. */
function readEnv(
  env: RawEnv,
  key: string,
  fallback: string,
  received: Record<string, string>,
): string {
  const value = env[key];
  if (value === undefined) {
    received[key] = '(not set)';
    return fallback;
  }
  const text = typeof value === 'string' ? value : String(value);
  received[key] = text;
  return text;
}

/** Trims an optional environment value, mapping blanks to `undefined`. */
function optionalText(value: string | boolean | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Turns a zod issue into the developer-facing {@link ConfigIssue}. */
function toConfigIssue(issue: RawIssue, received: Record<string, string>): ConfigIssue {
  const field = String(issue.path[0] ?? '(env)');
  const help = FIELD_HELP[field];
  const value = received[field];
  return {
    field,
    message: help ? `${field} ${issue.message}` : issue.message,
    ...(value === undefined ? {} : { received: value }),
    ...(help ? { expected: help.expected } : {}),
    ...(help ? { hint: help.hint } : {}),
  };
}

/**
 * Validates the demo's environment variables.
 *
 * `VITE_RPC_URL`, `VITE_NETWORK_PASSPHRASE` and `VITE_CONTRACT_ID` fall back to
 * the public testnet values when they are not set, so a fresh clone runs; a
 * value that is *set* but malformed is reported instead of being silently
 * replaced, because a typo there points at the wrong chain.
 *
 * Never throws: an invalid environment comes back as `{ ok: false, issues }` so
 * the app can render a configuration screen (#1146).
 */
export function loadConfig(env: RawEnv = import.meta.env): ConfigResult {
  const received: Record<string, string> = {};
  const raw = {
    VITE_RPC_URL: readEnv(env, 'VITE_RPC_URL', DEFAULT_RPC_URL, received),
    VITE_NETWORK_PASSPHRASE: readEnv(
      env,
      'VITE_NETWORK_PASSPHRASE',
      DEFAULT_NETWORK_PASSPHRASE,
      received,
    ),
    VITE_CONTRACT_ID: readEnv(env, 'VITE_CONTRACT_ID', DEFAULT_CONTRACT_ID, received),
  };

  const parsed = demoEnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => toConfigIssue(issue, received));
    return { ok: false, issues };
  }

  return {
    ok: true,
    config: {
      rpcUrl: parsed.data.VITE_RPC_URL,
      networkPassphrase: parsed.data.VITE_NETWORK_PASSPHRASE,
      contractId: parsed.data.VITE_CONTRACT_ID,
      walletAddress: optionalText(env.VITE_WALLET_ADDRESS),
    },
  };
}

/**
 * Renders the issues as a single block of plain text.
 *
 * Useful for the browser console and for failing a CI step on a bad `.env`.
 */
export function describeConfigError(issues: readonly ConfigIssue[]): string {
  const header = `The bc-forge React demo cannot start with the current environment (${issues.length} problem${
    issues.length === 1 ? '' : 's'
  }).`;
  const details = issues.map((issue) => {
    const lines = [`- ${issue.message}`];
    if (issue.received !== undefined) {
      lines.push(`    received: ${issue.received === '' ? '(empty string)' : issue.received}`);
    }
    if (issue.expected !== undefined) lines.push(`    expected: ${issue.expected}`);
    if (issue.hint !== undefined) lines.push(`    hint: ${issue.hint}`);
    return lines.join('\n');
  });
  return [header, ...details].join('\n');
}