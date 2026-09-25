/**
 * upgrade-history.ts
 *
 * Local WASM upgrade history management.
 *
 * When the CLI submits a successful upgrade it appends an entry to a JSON
 * history file (default: ~/.bc-forge/upgrade-history.json). Each entry is
 * keyed by contract ID and records the previous and new WASM hashes so that
 * `upgrade --to-last-good` can propose the previous hash through the admin
 * multisig path.
 *
 * No secrets are ever written to the history file.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface UpgradeHistoryEntry {
  /** The WASM hash that was deployed (new hash after upgrade). */
  newHash: string;
  /** The WASM hash that was deployed before this upgrade (rollback target). */
  previousHash: string;
  /** ISO 8601 timestamp of when the entry was recorded. */
  recordedAt: string;
  /** On-chain transaction hash, if available. */
  txHash?: string;
}

/** Map from contract ID to ordered list of history entries (oldest first). */
export type UpgradeHistoryFile = Record<string, UpgradeHistoryEntry[]>;

/**
 * Returns the path to the upgrade history file.
 *
 * Override via the `BC_FORGE_UPGRADE_HISTORY` environment variable or by
 * passing `historyPath` directly. The default is `~/.bc-forge/upgrade-history.json`.
 */
export function resolveHistoryPath(historyPath?: string): string {
  if (historyPath) {
    return historyPath;
  }
  if (process.env.BC_FORGE_UPGRADE_HISTORY) {
    return process.env.BC_FORGE_UPGRADE_HISTORY;
  }
  return path.join(os.homedir(), ".bc-forge", "upgrade-history.json");
}

/**
 * Read and parse the history file. Returns an empty object if the file does
 * not exist or cannot be parsed.
 */
export function readHistoryFile(historyPath: string): UpgradeHistoryFile {
  try {
    const raw = fs.readFileSync(historyPath, "utf8");
    return JSON.parse(raw) as UpgradeHistoryFile;
  } catch {
    return {};
  }
}

/**
 * Write the history object back to disk, creating parent directories as needed.
 */
export function writeHistoryFile(historyPath: string, data: UpgradeHistoryFile): void {
  const dir = path.dirname(historyPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(historyPath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Append a new upgrade entry for the given contract ID.
 *
 * The entry records the previous and new WASM hashes so that
 * `--to-last-good` can later propose the previous hash.
 */
export function appendUpgradeHistory(
  contractId: string,
  previousHash: string,
  newHash: string,
  txHash?: string,
  historyPath?: string,
): void {
  const resolved = resolveHistoryPath(historyPath);
  const data = readHistoryFile(resolved);

  if (!data[contractId]) {
    data[contractId] = [];
  }

  data[contractId].push({
    newHash,
    previousHash,
    recordedAt: new Date().toISOString(),
    ...(txHash ? { txHash } : {}),
  });

  writeHistoryFile(resolved, data);
}

/**
 * Look up the most recent previous WASM hash for a contract.
 *
 * Returns the `previousHash` from the latest history entry, or `null` when
 * no history exists for the contract.
 */
export function getLastGoodHash(
  contractId: string,
  historyPath?: string,
): string | null {
  const resolved = resolveHistoryPath(historyPath);
  const data = readHistoryFile(resolved);
  const entries = data[contractId];

  if (!entries || entries.length === 0) {
    return null;
  }

  return entries[entries.length - 1].previousHash;
}
