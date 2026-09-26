import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { mergeNetworkOptions, parseNetworkName, resolveNetworkConfig } from '../network.js';
import { writeJsonAtomic } from './deployments.js';

/** Project registry of contract ids keyed by network and alias. */
export const DEFAULT_REGISTRY_PATH = 'deployments.json';

const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;
const SECRET_KEY_REGEX = /^S[A-Z2-7]{55}$/;
const ALIAS_REGEX = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export type NetworkAliasMap = Record<string, Record<string, string>>;

/**
 * Raised when a contract-id flag names an alias that is not stored for the
 * selected network. The message always includes the alias.
 */
export class UnknownAliasError extends Error {
  readonly alias: string;
  readonly network: string;

  constructor(alias: string, network: string) {
    super(
      `Unknown deployment alias "${alias}" for network "${network}". ` +
        `Register it with: bc-forge deployments register ${alias} <id> --network ${network}`
    );
    this.name = 'UnknownAliasError';
    this.alias = alias;
    this.network = network;
  }
}

/** True when `value` is a StrKey Soroban contract id (C... 56 characters). */
export function isContractId(value: string): boolean {
  return CONTRACT_ID_REGEX.test(value);
}

/** True when `value` is a Stellar secret seed. Those must never be stored. */
export function isSecretKey(value: string): boolean {
  return SECRET_KEY_REGEX.test(value);
}

/**
 * Reads a deployments document. Missing files return null.
 * Corrupt JSON throws when `strict` is set so register does not wipe the file.
 */
export function readDeploymentsDocument(
  filePath: string = DEFAULT_REGISTRY_PATH,
  options: { strict?: boolean } = {},
): Record<string, unknown> | null {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (err: unknown) {
    if (!options.strict) return null;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Deployments registry at ${resolved} is not valid JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (!options.strict) return null;
    throw new Error(`Deployments registry at ${resolved} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function contractIdFromAliasValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const contractId = (value as { contractId?: unknown }).contractId;
    if (typeof contractId === 'string' && contractId.trim() !== '') return contractId.trim();
  }
  return undefined;
}

/** Pulls the `networks` map out of a deployments document. */
export function networksFromDocument(doc: Record<string, unknown> | null): NetworkAliasMap {
  const networks = doc?.networks;
  if (!networks || typeof networks !== 'object' || Array.isArray(networks)) return {};

  const out: NetworkAliasMap = {};
  for (const [network, aliases] of Object.entries(networks as Record<string, unknown>)) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) continue;
    const bucket: Record<string, string> = {};
    for (const [alias, value] of Object.entries(aliases as Record<string, unknown>)) {
      const contractId = contractIdFromAliasValue(value);
      if (contractId && !isSecretKey(contractId)) bucket[alias] = contractId;
    }
    out[network] = bucket;
  }
  return out;
}

/**
 * Returns a copy of `networks` with `aliases` stored under the canonical network.
 * Empty and secret values are skipped. Other networks are left unchanged.
 */
export function mergeNetworkAliases(
  networks: NetworkAliasMap,
  network: string,
  aliases: Record<string, string | undefined>,
): NetworkAliasMap {
  const canonical = parseNetworkName(network);
  const bucket: Record<string, string> = { ...(networks[canonical] ?? {}) };

  for (const [alias, contractId] of Object.entries(aliases)) {
    if (!contractId || !contractId.trim() || isSecretKey(contractId.trim())) continue;
    if (!ALIAS_REGEX.test(alias)) continue;
    bucket[alias] = contractId.trim();
  }

  if (Object.keys(bucket).length === 0) {
    const rest = { ...networks };
    delete rest[canonical];
    return rest;
  }

  return {
    ...networks,
    [canonical]: bucket,
  };
}

function assertRegisterInput(alias: string, contractId: string): { alias: string; contractId: string } {
  const trimmedAlias = alias.trim();
  const trimmedId = contractId.trim();

  if (!ALIAS_REGEX.test(trimmedAlias)) {
    throw new Error(
      `Invalid alias "${trimmedAlias}". Use a short name such as "token" (letters, digits, _ or -).`
    );
  }
  if (isContractId(trimmedAlias)) {
    throw new Error(`Alias "${trimmedAlias}" looks like a contract id. Choose a short name such as "token".`);
  }
  if (isSecretKey(trimmedId)) {
    throw new Error('Refusing to store a secret key in the deployments registry.');
  }
  if (!isContractId(trimmedId)) {
    throw new Error(
      `Invalid contract id "${trimmedId}". Expected a 56-character C... Soroban contract id.`
    );
  }

  return { alias: trimmedAlias, contractId: trimmedId };
}

export interface RegisterAliasInput {
  alias: string;
  contractId: string;
  network: string;
  filePath?: string;
}

export interface RegisterAliasResult {
  filePath: string;
  network: string;
  alias: string;
  contractId: string;
}

/**
 * Stores `alias` → contract id for one network inside the project registry.
 * Other networks, and any export snapshot already in the file, are preserved.
 * Secret keys are rejected.
 */
export function registerDeploymentAlias(input: RegisterAliasInput): RegisterAliasResult {
  const filePath = input.filePath ?? DEFAULT_REGISTRY_PATH;
  const network = parseNetworkName(input.network);
  const { alias, contractId } = assertRegisterInput(input.alias, input.contractId);

  const existing = readDeploymentsDocument(filePath, { strict: true }) ?? {};
  const networks = mergeNetworkAliases(networksFromDocument(existing), network, {
    [alias]: contractId,
  });

  const next: Record<string, unknown> = {
    ...existing,
    version: typeof existing.version === 'string' ? existing.version : '1.0.0',
    networks,
  };

  const written = writeJsonAtomic(filePath, next, true);
  if (!written.success) {
    throw new Error(written.error ?? `Failed to write deployments registry to ${filePath}`);
  }

  return {
    filePath: written.filePath,
    network,
    alias,
    contractId,
  };
}

export interface ResolveContractReferenceOptions {
  network: string;
  filePath?: string;
}

/**
 * Returns `value` when it is already a contract id. Otherwise looks the alias
 * up for `network` only. A missing alias throws {@link UnknownAliasError}.
 */
export function resolveContractReference(
  value: string,
  options: ResolveContractReferenceOptions,
): string {
  const trimmed = value.trim();
  if (isContractId(trimmed)) return trimmed;

  const network = parseNetworkName(options.network);
  const filePath = options.filePath ?? DEFAULT_REGISTRY_PATH;
  const doc = readDeploymentsDocument(filePath, { strict: true });
  const contractId = networksFromDocument(doc)[network]?.[trimmed];
  if (!contractId) {
    throw new UnknownAliasError(trimmed, network);
  }
  return contractId;
}

/**
 * Resolves a `--contract-id` (or similar) flag for the network selected on
 * `command`. Raw contract ids pass through. Undefined stays undefined.
 */
export function resolveContractIdOption(
  command: Command,
  value: string | undefined,
  filePath?: string,
): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const network = resolveNetworkConfig(mergeNetworkOptions(command)).name;
  return resolveContractReference(value, { network, filePath });
}
