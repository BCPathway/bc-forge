// SPDX-License-Identifier: MIT
import { Command } from "commander";
import {
  Keypair,
  Contract,
  TransactionBuilder,
  xdr,
  hash,
  rpc as SorobanRpcNs,
} from "@stellar/stellar-sdk";
import { addNetworkOptions } from "../network.js";
import { prepareSignAndSubmit } from "../utils/soroban-tx.js";
import logger from "../utils/logger.js";
import { writeJson } from "../utils/output.js";
import { resolveContractIdOption } from "../utils/registry.js";
import {
  appendUpgradeHistory,
  getLastGoodHash,
} from "../utils/upgrade-history.js";
import { resolveSourceSecret } from "../utils/config.js";

export interface FeeEstimate {
  baseFee: string;
  resourceFee: string;
  totalFee: string;
}

export interface UpgradeResult {
  success: boolean;
  txHash?: string;
  proposalId?: bigint;
  wasmHash?: string;
  message: string;
  estimate?: FeeEstimate;
  /** Per-getter results when `--simulate` / `--check-storage` was used. */
  storageCheck?: StorageCheckReport;
}

export interface StorageGetterResult {
  getter: string;
  ok: boolean;
  /** Failure diagnostic, or a warning when the getter decoded but looks suspicious. */
  detail?: string;
}

export interface StorageCheckReport {
  ok: boolean;
  results: StorageGetterResult[];
  warnings: string[];
}

/** Core views that must stay callable and decodable across an upgrade. */
export const STORAGE_CHECK_GETTERS = [
  "name",
  "symbol",
  "decimals",
  "total_supply",
  "get_storage_info",
] as const;

/**
 * Simulates each essential getter against the contract and asserts the
 * response is a decodable XDR ScVal. Failures carry the getter name and the
 * RPC diagnostic so operators can see exactly which view broke.
 */
export async function checkStorageCompatibility(
  server: any,
  sourceAccount: any,
  contractId: string,
  networkPassphrase: string,
): Promise<StorageCheckReport> {
  const contract = new Contract(contractId);
  const results: StorageGetterResult[] = [];
  const warnings: string[] = [];

  for (const getter of STORAGE_CHECK_GETTERS) {
    try {
      const tx = new TransactionBuilder(sourceAccount, {
        fee: "100",
        networkPassphrase,
      })
        .addOperation(contract.call(getter))
        .setTimeout(30)
        .build();
      const sim: any = await server.simulateTransaction(tx);
      if (sim && "error" in sim && sim.error) {
        results.push({
          getter,
          ok: false,
          detail: `reverted during simulation: ${
            typeof sim.error === "string"
              ? sim.error
              : JSON.stringify(sim.error)
          }`,
        });
        continue;
      }
      const retval = sim?.result?.retval;
      if (!retval) {
        results.push({ getter, ok: false, detail: "returned no value" });
        continue;
      }
      try {
        // Round-trip through XDR to prove the value is well-formed.
        xdr.ScVal.fromXDR(retval.toXDR("base64"), "base64");
      } catch (e) {
        results.push({
          getter,
          ok: false,
          detail: `response is not valid XDR ScVal: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
      if (retval.toXDR("base64") === xdr.ScVal.scvVoid().toXDR("base64")) {
        warnings.push(
          `${getter}() returned void; instance storage keys may have been modified unexpectedly`,
        );
      }
      results.push({ getter, ok: true });
    } catch (e) {
      results.push({
        getter,
        ok: false,
        detail: `simulation error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return { ok: results.every((r) => r.ok), results, warnings };
}

export interface UpgradeOptions {
  wasmPath: string;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  source: string;
  proposalId?: string;
  dryRun?: boolean;
  estimate?: boolean;
  /** Simulate the upgrade and run storage-compatibility getter checks without submitting. */
  simulate?: boolean;
  timeout?: number;
  /** When true, use the previous WASM hash from local history instead of a WASM file. */
  toLastGood?: boolean;
  /** Override the path to the local upgrade-history file (mainly for tests). */
  historyPath?: string;
}

export function createUpgradeCommand(): Command {
  const cmd = new Command("upgrade")
    .description("Submit a multisig upgrade proposal for a deployed contract")
    .option("--wasm <path>", "Path to the new WASM binary")
    .requiredOption(
      "--contract-id <id>",
      "Contract ID, or a deployment alias for the selected network",
    )
    .option(
      "--source <secret>",
      "Source account secret key (use STELLAR_SECRET_KEY instead)",
    )
    .option("--proposal-id <id>", "Existing proposal ID to execute")
    .option("--dry-run", "Simulate without submitting on-chain", false)
    .option(
      "--simulate",
      "Simulate the upgrade and verify core getters (name, symbol, decimals, total_supply, get_storage_info) return decodable values; never submits",
      false,
    )
    .option("--check-storage", "Alias of --simulate", false)
    .option(
      "--estimate",
      "Dry-run to estimate total fee cost without submitting",
      false,
    )
    .option(
      "--timeout <ms>",
      "Timeout in milliseconds to wait for on-chain confirmation",
      "30000",
    )
    .option(
      "--to-last-good",
      "Propose the previous WASM hash stored in local upgrade history (rollback)",
      false,
    )
    .option("--json", "Print the transaction hash and WASM hash as JSON");

  addNetworkOptions(cmd);

  cmd.action(async (opts, command) => {
    if (!opts.toLastGood && !opts.wasm) {
      throw new Error("required option '--wasm <path>' not specified");
    }
    try {
      const contractId = resolveContractIdOption(command, opts.contractId);
      const result = await runUpgrade({
        ...opts,
        source: await resolveSourceSecret(opts.source),
        contractId: contractId ?? opts.contractId,
        wasmPath: opts.wasmPath ?? opts.wasm ?? "",
        toLastGood: opts.toLastGood ?? false,
        simulate: Boolean(opts.simulate || opts.checkStorage),
      });
      if (opts.json) {
        writeJson(result);
        if (!result.success) {
          logger.error(result.message);
          process.exitCode = 1;
        }
      }
    } catch (err: unknown) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

  return cmd;
}

export async function runUpgrade(opts: UpgradeOptions): Promise<UpgradeResult> {
  const fs = await import("node:fs");

  // ── --to-last-good path ────────────────────────────────────────────────────
  if (opts.toLastGood) {
    const previousHash = getLastGoodHash(opts.contractId, opts.historyPath);
    if (!previousHash) {
      return {
        success: false,
        message: `No upgrade history found for contract ${opts.contractId}. Run a successful upgrade first to record a rollback target.`,
      };
    }

    return runUpgradeWithHash({
      hash: previousHash,
      contractId: opts.contractId,
      rpcUrl: opts.rpcUrl,
      networkPassphrase: opts.networkPassphrase,
      source: opts.source,
      dryRun: opts.dryRun,
      estimate: opts.estimate,
      simulate: opts.simulate,
      timeout: opts.timeout,
      isRollback: true,
    });
  }

  // ── Normal upgrade path ────────────────────────────────────────────────────

  // 1. Validate WASM path exists
  if (!opts.wasmPath) {
    return {
      success: false,
      message: "Either --wasm <path> or --to-last-good is required.",
    };
  }

  if (!fs.existsSync(opts.wasmPath)) {
    return {
      success: false,
      message: `WASM file not found: ${opts.wasmPath}`,
    };
  }

  const wasmBytes = fs.readFileSync(opts.wasmPath);
  if (wasmBytes.length === 0) {
    return {
      success: false,
      message: `WASM file is empty: ${opts.wasmPath}`,
    };
  }

  const wasmHash = Buffer.from(hash(wasmBytes)).toString("hex");

  // Compute the previous hash before this upgrade so it can be stored.
  // We always record the new hash and the previous hash regardless of dry-run
  // or estimate mode, because those modes do not mutate on-chain state.
  // History is only appended on a confirmed on-chain submission.

  const result = await runUpgradeWithHash({
    hash: wasmHash,
    wasmBytes,
    contractId: opts.contractId,
    rpcUrl: opts.rpcUrl,
    networkPassphrase: opts.networkPassphrase,
    source: opts.source,
    dryRun: opts.dryRun,
    estimate: opts.estimate,
    simulate: opts.simulate,
    timeout: opts.timeout,
    isRollback: false,
  });

  // Record history when the on-chain upgrade was confirmed.
  if (
    result.success &&
    !opts.dryRun &&
    !opts.estimate &&
    !opts.simulate &&
    result.txHash
  ) {
    // Retrieve the current "last good" hash (which will become the previous
    // hash for the next upgrade) before we overwrite it.
    const previousHash =
      getLastGoodHash(opts.contractId, opts.historyPath) ?? wasmHash;
    try {
      appendUpgradeHistory(
        opts.contractId,
        previousHash,
        wasmHash,
        result.txHash,
        opts.historyPath,
      );
    } catch {
      // History recording is best-effort; do not fail the upgrade result.
    }
  }

  return result;
}

// ── Internal shared upgrade logic ────────────────────────────────────────────

interface UpgradeWithHashOptions {
  hash: string;
  wasmBytes?: Buffer;
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  source: string;
  dryRun?: boolean;
  estimate?: boolean;
  simulate?: boolean;
  timeout?: number;
  isRollback: boolean;
}

async function runUpgradeWithHash(
  opts: UpgradeWithHashOptions,
): Promise<UpgradeResult> {
  const wasmHash = opts.hash;

  // When rolling back we pass the hash directly as bytes; when deploying a
  // new WASM we pass the full binary. In both cases the `upgrade` entrypoint
  // receives raw bytes, which on Soroban is treated as the WASM hash.
  const payloadBytes: Buffer = opts.wasmBytes ?? Buffer.from(wasmHash, "hex");

  try {
    // 2. Connect to Soroban RPC
    const server = new SorobanRpcNs.Server(opts.rpcUrl, {
      allowHttp: opts.rpcUrl.startsWith("http://"),
    });

    const sourceKeypair = Keypair.fromSecret(opts.source);
    const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

    // 3. Build the upgrade transaction
    const contract = new Contract(opts.contractId);

    const upgradeOp = contract.call(
      "upgrade",
      xdr.ScVal.scvBytes(payloadBytes),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(upgradeOp)
      .setTimeout(30)
      .build();

    const rollbackNote = opts.isRollback ? " (rollback to previous hash)" : "";

    // 4. --estimate: simulate and return fee breakdown
    if (opts.estimate) {
      const simResult = await server.simulateTransaction(tx);
      if ("error" in simResult) {
        return {
          success: false,
          message: `Simulation failed: ${JSON.stringify((simResult as any).error)}`,
        };
      }

      const resourceFee = simResult.minResourceFee ?? "0";
      const baseFee = "100";
      const totalFee = String(Number(baseFee) + Number(resourceFee));

      return {
        success: true,
        wasmHash,
        estimate: { baseFee, resourceFee, totalFee },
        message: `Fee estimate for upgrade${rollbackNote}: base=${baseFee} resource=${resourceFee} total=${totalFee} stroops (hash ${wasmHash})`,
      };
    }

    // 4b. --simulate / --check-storage: simulate the upgrade, then verify getters
    if (opts.simulate) {
      const upgradeSim: any = await server.simulateTransaction(tx);
      if ("error" in upgradeSim && upgradeSim.error) {
        return {
          success: false,
          wasmHash,
          message: `Upgrade simulation failed: ${JSON.stringify(upgradeSim.error)}`,
        };
      }
      const report = await checkStorageCompatibility(
        server,
        sourceAccount,
        opts.contractId,
        opts.networkPassphrase,
      );
      const failed = report.results.filter((r) => !r.ok);
      for (const w of report.warnings) logger.warn(`Warning: ${w}`);
      if (!report.ok) {
        const lines = failed
          .map((r) => `  - ${r.getter}(): ${r.detail}`)
          .join("\n");
        return {
          success: false,
          wasmHash,
          storageCheck: report,
          message: `Storage compatibility check failed; ${failed.length} getter(s) not callable:\n${lines}`,
        };
      }
      return {
        success: true,
        wasmHash,
        storageCheck: report,
        message: `Upgrade simulation succeeded${rollbackNote}; all ${report.results.length} core getters returned decodable values. Nothing was submitted. WASM hash: ${wasmHash}.`,
      };
    }

    // 5. Dry-run: simulate only
    if (opts.dryRun) {
      const simResult = await server.simulateTransaction(tx);
      if ("error" in simResult) {
        return {
          success: false,
          message: `Dry-run simulation failed: ${JSON.stringify((simResult as any).error)}`,
        };
      }
      return {
        success: true,
        message: `Dry-run simulation succeeded${rollbackNote}. WASM hash: ${wasmHash}.`,
        wasmHash,
      };
    }

    // 6. Submit on-chain (simulate + assemble fee/footprint, sign, submit, await confirmation)
    const timeout = Number(opts.timeout) || 30000;
    const outcome = await prepareSignAndSubmit(server, tx, sourceKeypair, {
      deadline: Date.now() + timeout,
    });

    switch (outcome.outcome) {
      case "simulation_failed":
        return {
          success: false,
          wasmHash,
          message: `Simulation failed: ${outcome.error}`,
        };
      case "submission_failed":
        return {
          success: false,
          wasmHash,
          txHash: outcome.hash,
          message: `Transaction submission failed: ${outcome.error}`,
        };
      case "failed_on_ledger":
        return {
          success: false,
          wasmHash,
          txHash: outcome.hash,
          message: `Upgrade transaction failed on-ledger. Hash: ${outcome.hash}`,
        };
      case "timed_out":
        return {
          success: false,
          wasmHash,
          txHash: outcome.hash,
          message: `Timed out after ${timeout}ms waiting for confirmation. Hash: ${outcome.hash} (last status: ${outcome.lastStatus})`,
        };
      case "confirmed":
        return {
          success: true,
          txHash: outcome.hash,
          wasmHash,
          message: `Upgrade transaction submitted${rollbackNote}. Hash: ${outcome.hash}`,
        };
    }
  } catch (err) {
    return {
      success: false,
      message: `Upgrade error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
