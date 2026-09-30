// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
import { StrKey } from '@stellar/stellar-sdk';
import { getCliConfigPath, getFileConfig } from './config.js';

/** Letter, then letters, digits, underscore, or hyphen. Not a raw G... address. */
export const ACCOUNT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

const G_ADDRESS_SHAPE = /^G[A-Z2-7]{55}$/;

export function assertEd25519PublicKey(publicKey: string): void {
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    throw new Error(
      `Invalid public key "${publicKey}". Stellar StrKey checksum check failed.`
    );
  }
}

function assertAccountName(name: string): void {
  if (!ACCOUNT_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid account name "${name}". Use a letter followed by letters, digits, "_" or "-".`
    );
  }
}

function readConfigObject(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`CLI config at ${filePath} is not valid JSON: ${message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`CLI config at ${filePath} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function writeConfigObject(filePath: string, config: Record<string, unknown>): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

function accountsFromUnknown(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  const accounts: Record<string, string> = {};
  for (const [name, key] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key === 'string') accounts[name] = key;
  }
  return accounts;
}

/** Accounts saved in the CLI config file, without the project manifest. */
export function readStoredAccounts(filePath = getCliConfigPath()): Record<string, string> {
  try {
    return accountsFromUnknown(readConfigObject(filePath).accounts);
  } catch {
    return {};
  }
}

/**
 * Address book used to resolve names.
 * Project `.bc-forge.json` entries override the user CLI config when both define a name.
 */
export function loadAccounts(filePath = getCliConfigPath()): Record<string, string> {
  const stored = readStoredAccounts(filePath);
  const project = accountsFromUnknown(getFileConfig()?.accounts);
  return { ...stored, ...project };
}

/**
 * Save a named account. The public key is checked with Stellar StrKey before the file is written.
 * A bad checksum throws and leaves the config unchanged.
 */
export function saveAccount(
  name: string,
  publicKey: string,
  filePath = getCliConfigPath()
): Record<string, string> {
  const accountName = name.trim();
  const key = publicKey.trim();
  assertAccountName(accountName);
  assertEd25519PublicKey(key);

  const config = readConfigObject(filePath);
  const accounts = accountsFromUnknown(config.accounts);
  accounts[accountName] = key;
  config.accounts = accounts;
  writeConfigObject(filePath, config);
  return accounts;
}

export function removeAccount(name: string, filePath = getCliConfigPath()): void {
  const accountName = name.trim();
  const config = readConfigObject(filePath);
  const accounts = accountsFromUnknown(config.accounts);
  if (!Object.prototype.hasOwnProperty.call(accounts, accountName)) {
    throw new Error(`Unknown account "${accountName}".`);
  }
  delete accounts[accountName];
  config.accounts = accounts;
  writeConfigObject(filePath, config);
}

/**
 * Replace a book name with its public key.
 * A raw address is returned unchanged so existing callers keep their own checks.
 */
export function resolveAccountReference(
  ref: string,
  accounts: Record<string, string> = loadAccounts()
): string {
  const value = ref.trim();
  if (Object.prototype.hasOwnProperty.call(accounts, value)) {
    const key = accounts[value];
    assertEd25519PublicKey(key);
    return key;
  }
  return value;
}

/**
 * Resolve a mint or transfer address.
 * Names come from the address book. Raw G... addresses must pass the StrKey checksum.
 */
export function resolveAccount(
  ref: string,
  accounts: Record<string, string> = loadAccounts()
): string {
  const value = ref.trim();
  if (Object.prototype.hasOwnProperty.call(accounts, value)) {
    const key = accounts[value];
    assertEd25519PublicKey(key);
    return key;
  }
  if (StrKey.isValidEd25519PublicKey(value)) return value;
  if (G_ADDRESS_SHAPE.test(value)) {
    throw new Error(
      `Invalid public key "${value}". Stellar StrKey checksum check failed.`
    );
  }
  throw new Error(
    `Unknown account "${value}". Add it with \`bc-forge account add ${value} <publicKey>\`.`
  );
}
