// SPDX-License-Identifier: MIT
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export const MAINNET_PASSPHRASE = "Public Global Stellar Network ; September 2015";
export const HORIZON_MAINNET_URL = "https://horizon.stellar.org";

export const SINGLE_SIGNER_WARNING =
  "WARNING: Deploying to Public Mainnet with a single-signer admin account violates production security policy!";

export interface AccountSigners {
  /** Number of signers with non-zero weight. */
  signerCount: number;
  /** Medium threshold of the account. */
  medThreshold: number;
}

export type FetchAccountSigners = (address: string) => Promise<AccountSigners>;

export function isMainnet(networkPassphrase: string): boolean {
  return networkPassphrase === MAINNET_PASSPHRASE;
}

/** Contract addresses (C...) are governed by their own logic and are not checked. */
export function isContractAddress(address: string): boolean {
  return address.startsWith("C");
}

export async function fetchAccountSignersFromHorizon(
  address: string,
  horizonUrl: string = HORIZON_MAINNET_URL,
  fetchImpl: typeof fetch = fetch
): Promise<AccountSigners> {
  const res = await fetchImpl(`${horizonUrl}/accounts/${address}`);
  if (!res.ok) {
    throw new Error(`Unable to inspect admin account ${address} (Horizon HTTP ${res.status})`);
  }
  const body = (await res.json()) as {
    signers?: Array<{ weight: number }>;
    thresholds?: { med_threshold: number };
  };
  const signerCount = (body.signers ?? []).filter((s) => s.weight > 0).length;
  return { signerCount, medThreshold: body.thresholds?.med_threshold ?? 0 };
}

export function isSingleSigner(info: AccountSigners): boolean {
  return info.signerCount <= 1 && info.medThreshold <= 1;
}

export async function promptConfirm(question: string): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [y/N]: `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

export interface MainnetGuardOptions {
  networkPassphrase: string;
  admin: string;
  forceSingleSigner?: boolean;
  interactive?: boolean;
  fetchAccount?: FetchAccountSigners;
  confirm?: (question: string) => Promise<boolean>;
  warn?: (message: string) => void;
}

export interface MainnetGuardResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Blocks mainnet deployments whose admin is a single-signer account unless
 * confirmed interactively or bypassed with --force-single-signer-unsecure.
 */
export async function checkMainnetAdmin(opts: MainnetGuardOptions): Promise<MainnetGuardResult> {
  if (!isMainnet(opts.networkPassphrase) || isContractAddress(opts.admin)) {
    return { allowed: true };
  }
  const fetchAccount = opts.fetchAccount ?? ((a: string) => fetchAccountSignersFromHorizon(a));
  const warn = opts.warn ?? ((m: string) => console.warn(m));

  const info = await fetchAccount(opts.admin);
  if (!isSingleSigner(info)) {
    return { allowed: true };
  }

  warn(SINGLE_SIGNER_WARNING);
  if (opts.forceSingleSigner) {
    warn("Proceeding because --force-single-signer-unsecure was supplied.");
    return { allowed: true };
  }
  const interactive = opts.interactive ?? Boolean(input.isTTY);
  if (interactive) {
    const confirm = opts.confirm ?? promptConfirm;
    if (await confirm("Continue with the single-signer admin anyway?")) {
      return { allowed: true };
    }
    return { allowed: false, reason: "Deployment aborted by operator." };
  }
  return {
    allowed: false,
    reason: `${SINGLE_SIGNER_WARNING} Use a multisig admin or pass --force-single-signer-unsecure.`,
  };
}
