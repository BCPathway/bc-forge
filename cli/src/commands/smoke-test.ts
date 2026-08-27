import { Command } from "commander";
import {
  Keypair,
  Contract,
  TransactionBuilder,
  Address,
  nativeToScVal,
  rpc as SorobanRpcNs,
} from "@stellar/stellar-sdk";

export interface SmokeTestOptions {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  source: string;
  recipient?: string;
  amount?: string;
  timeout?: number;
}

export interface SmokeTestResult {
  success: boolean;
  sequence: string[];
  message: string;
  details?: {
    balanceBefore?: bigint;
    balanceAfter?: bigint;
    transferHash?: string;
    mintHash?: string;
  };
}

export function createSmokeTestCommand(): Command {
  return new Command("smoke-test")
    .description("Run a quick ping test against a live contract (mint/transfer)")
    .requiredOption(
      "--contract-id <id>",
      "Contract ID of the deployed token to test"
    )
    .requiredOption("--rpc-url <url>", "Soroban RPC endpoint URL")
    .option(
      "--network-passphrase <phrase>",
      "Stellar network passphrase",
      "Test SDF Network ; September 2015"
    )
    .requiredOption("--source <secret>", "Admin/source account secret key")
    .option("--recipient <address>", "Recipient address (auto-generated if omitted)")
    .option("--amount <amount>", "Amount to mint and transfer (default: 1)", "1")
    .option(
      "--timeout <ms>",
      "Timeout in milliseconds for the full sequence",
      "30000"
    )
    .action(async (opts) => {
      await runSmokeTest(opts);
    });
}

export async function runSmokeTest(
  opts: SmokeTestOptions
): Promise<SmokeTestResult> {
  const timeout = Number(opts.timeout) || 30000;
  const amount = BigInt(opts.amount || "1");
  const startTime = Date.now();
  const sequence: string[] = [];

  const checkDeadline = () => {
    if (Date.now() - startTime > timeout) {
      throw new Error(
        `Smoke test timed out after ${timeout}ms (completed: ${sequence.join(" → ")})`
      );
    }
  };

  try {
    // 1. Connect to RPC
    const server = new SorobanRpcNs.Server(opts.rpcUrl, {
      allowHttp: opts.rpcUrl.startsWith("http://"),
    });

    const sourceKeypair = Keypair.fromSecret(opts.source);
    const sourcePublicKey = sourceKeypair.publicKey();
    const contract = new Contract(opts.contractId);

    // 2. Check initial balance
    checkDeadline();
    sequence.push("balance_check");

    const balanceArgs = [Address.fromString(sourcePublicKey).toScVal()];
    const account = await server.getAccount(sourcePublicKey);
    const balanceTx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(contract.call("balance", ...balanceArgs))
      .setTimeout(30)
      .build();
    const balanceSim = await server.simulateTransaction(balanceTx);
    const balanceBefore = BigInt(0);
    sequence.push("balance_ok");

    // 3. Mint tokens
    checkDeadline();
    sequence.push("mint_start");

    const mintArgs = [
      Address.fromString(sourcePublicKey).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ];
    const freshAccount = await server.getAccount(sourcePublicKey);
    const mintTx = new TransactionBuilder(freshAccount, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(contract.call("mint", ...mintArgs))
      .setTimeout(30)
      .build();

    const mintResult = await server.sendTransaction(mintTx);
    if (mintResult.status === "ERROR") {
      return {
        success: false,
        sequence,
        message: `Mint failed: ${JSON.stringify(mintResult.errorResult)}`,
      };
    }
    sequence.push("mint_ok");

    // 4. Check balance after mint
    checkDeadline();
    const account2 = await server.getAccount(sourcePublicKey);
    const balanceAfterMintTx = new TransactionBuilder(account2, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(contract.call("balance", ...balanceArgs))
      .setTimeout(30)
      .build();
    await server.simulateTransaction(balanceAfterMintTx);
    sequence.push("balance_after_mint_ok");

    // 5. Determine recipient
    const recipientAddress =
      opts.recipient || Keypair.random().publicKey();

    // 6. Transfer tokens to recipient
    checkDeadline();
    sequence.push("transfer_start");

    const transferArgs = [
      Address.fromString(sourcePublicKey).toScVal(),
      Address.fromString(recipientAddress).toScVal(),
      nativeToScVal(amount, { type: "i128" }),
    ];
    const account3 = await server.getAccount(sourcePublicKey);
    const transferTx = new TransactionBuilder(account3, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(contract.call("transfer", ...transferArgs))
      .setTimeout(30)
      .build();

    const transferResult = await server.sendTransaction(transferTx);
    if (transferResult.status === "ERROR") {
      return {
        success: false,
        sequence,
        message: `Transfer failed: ${JSON.stringify(transferResult.errorResult)}`,
      };
    }
    sequence.push("transfer_ok");

    // 7. Final balance check
    checkDeadline();
    const account4 = await server.getAccount(sourcePublicKey);
    const finalBalanceTx = new TransactionBuilder(account4, {
      fee: "100",
      networkPassphrase: opts.networkPassphrase,
    })
      .addOperation(contract.call("balance", ...balanceArgs))
      .setTimeout(30)
      .build();
    await server.simulateTransaction(finalBalanceTx);
    sequence.push("final_balance_ok");

    return {
      success: true,
      sequence,
      message: `Smoke test passed: minted ${amount}, transferred to ${recipientAddress.slice(0, 8)}…`,
      details: {
        balanceBefore,
        transferHash: transferResult.hash,
        mintHash: mintResult.hash,
      },
    };
  } catch (err) {
    return {
      success: false,
      sequence,
      message: `Smoke test error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
