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
}

export function createUpgradeCommand(): Command {
  const cmd = new Command("upgrade")
    .description("Submit a multisig upgrade proposal for a deployed contract")
    .requiredOption("--wasm <path>", "Path to the new WASM binary")
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
    );

  addNetworkOptions(cmd);

  cmd.action(async (opts) => {
    await runUpgrade({
      ...opts,
      wasmPath: opts.wasmPath ?? opts.wasm,
    });
  });

  return cmd;
}

export async function runUpgrade(opts: UpgradeOptions): Promise<UpgradeResult> {
  // 1. Validate WASM path exists
  const fs = await import("node:fs");
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

  try {
    // 2. Connect to Soroban RPC
    const server = new SorobanRpcNs.Server(opts.rpcUrl, {
      allowHttp: opts.rpcUrl.startsWith("http://"),
    });

    const sourceKeypair = Keypair.fromSecret(opts.source);
    const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

    // 3. Build the upgrade transaction
    const contract = new Contract(opts.contractId);
    const wasmHash = hash(wasmBytes).toString("hex");

    const upgradeOp = contract.call(
      "upgrade",
      xdr.ScVal.scvBytes(wasmBytes),
    );

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(upgradeOp)
      .setTimeout(30)
      .build();

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
        message: `Fee estimate for upgrade: base=${baseFee} resource=${resourceFee} total=${totalFee} stroops (WASM ${wasmBytes.length} bytes)`,
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
        message: `Dry-run simulation succeeded. WASM size: ${wasmBytes.length} bytes.`,
        wasmHash,
      };
    }

    // 6. Submit on-chain
    const result = await server.sendTransaction(tx);

    if (result.status === "ERROR") {
      return {
        success: false,
        message: `Transaction submission failed: ${JSON.stringify(result.errorResult)}`,
      };
    }

    return {
      success: true,
      txHash: result.hash,
      wasmHash,
      message: `Upgrade transaction submitted. Hash: ${result.hash}`,
    };
  } catch (err) {
    return {
      success: false,
      message: `Upgrade error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
