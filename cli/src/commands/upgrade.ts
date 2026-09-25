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
import { appendUpgradeHistory, getLastGoodHash } from "../utils/upgrade-history.js";

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
      "Contract ID of the deployed contract to upgrade"
    )
    .requiredOption("--source <secret>", "Source account secret key")
    .option("--proposal-id <id>", "Existing proposal ID to execute")
    .option("--dry-run", "Simulate without submitting on-chain", false)
    .option(
      "--estimate",
      "Dry-run to estimate total fee cost without submitting",
      false
    )
    .option(
      "--timeout <ms>",
      "Timeout in milliseconds to wait for on-chain confirmation",
      "30000"
    )
    .option(
      "--to-last-good",
      "Propose the previous WASM hash stored in local upgrade history (rollback)",
      false
    );

  addNetworkOptions(cmd);

  cmd.action(async (opts) => {
    await runUpgrade({
      ...opts,
      wasmPath: opts.wasmPath ?? opts.wasm ?? "",
      toLastGood: opts.toLastGood ?? false,
    });
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
    timeout: opts.timeout,
    isRollback: false,
  });

  // Record history when the on-chain upgrade was confirmed.
  if (result.success && !opts.dryRun && !opts.estimate && result.txHash) {
    // Retrieve the current "last good" hash (which will become the previous
    // hash for the next upgrade) before we overwrite it.
    const previousHash = getLastGoodHash(opts.contractId, opts.historyPath) ?? wasmHash;
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
  timeout?: number;
  isRollback: boolean;
}

async function runUpgradeWithHash(opts: UpgradeWithHashOptions): Promise<UpgradeResult> {
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
