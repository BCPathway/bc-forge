// SPDX-License-Identifier: MIT
import fs from "node:fs";
import crypto from "node:crypto";
import { Command } from "commander";
import { Contract, xdr, rpc as SorobanRpc } from "@stellar/stellar-sdk";
import { getClientConfig } from "../utils/config.js";
import logger from "../utils/logger.js";
import { writeJson } from "../utils/output.js";
import { addNetworkOptions, explicitNetworkOverrides } from "../network.js";
import { resolveContractIdOption } from "../utils/registry.js";

export type HashVerdict =
  "match" | "mismatch" | "missing_local" | "missing_onchain" | "invalid";

export interface HashComparison {
  name: string;
  contractId?: string;
  wasmPath?: string;
  localHash?: string;
  onChainHash?: string;
  verdict: HashVerdict;
  error?: string;
}

export interface HashFetcher {
  getLedgerEntries: SorobanRpc.Server["getLedgerEntries"];
}

/**
 * Computes the Soroban WASM hash of a local build artifact.
 *
 * Soroban identifies uploaded contract code by the SHA-256 of the raw .wasm
 * bytes, so hashing the file reproduces exactly the hash stored on-chain.
 */
export function hashLocalWasm(wasmPath: string): string {
  const bytes = fs.readFileSync(wasmPath);
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/**
 * Extracts the WASM hash referenced by a contract instance ledger entry.
 *
 * Returns undefined for Stellar-asset contracts, which have no uploaded WASM.
 */
export function extractOnChainHash(
  entryData: xdr.LedgerEntryData,
): string | undefined {
  const data = entryData as any;
  const arm = typeof data.arm === "function" ? data.arm() : data.type;
  if (arm !== "contractData") return undefined;

  const contractData =
    typeof data.contractData === "function"
      ? data.contractData()
      : data.contractData;
  if (!contractData) return undefined;

  const val =
    typeof contractData.val === "function"
      ? contractData.val()
      : contractData.val;
  if (!val) return undefined;

  const valArm = typeof val.arm === "function" ? val.arm() : val.type;
  const valSwitch =
    typeof val.switch === "function" ? val.switch()?.name : undefined;
  if (
    valArm !== "instance" &&
    valArm !== "scvContractInstance" &&
    valSwitch !== "scvContractInstance"
  ) {
    return undefined;
  }

  const instance =
    typeof val.instance === "function" ? val.instance() : val.instance;
  if (!instance) return undefined;

  const executable =
    typeof instance.executable === "function"
      ? instance.executable()
      : instance.executable;
  if (!executable) return undefined;

  const execArm =
    typeof executable.arm === "function" ? executable.arm() : executable.type;
  const execSwitch =
    typeof executable.switch === "function"
      ? executable.switch()?.name
      : undefined;
  if (
    execArm !== "wasmHash" &&
    execArm !== "contractExecutableWasm" &&
    execSwitch !== "contractExecutableWasm"
  ) {
    return undefined;
  }

  const wasmHash =
    typeof executable.wasmHash === "function"
      ? executable.wasmHash()
      : executable.wasmHash;
  if (!wasmHash) return undefined;

  const bytes =
    typeof wasmHash.toBytes === "function" ? wasmHash.toBytes() : wasmHash;
  return Buffer.from(bytes).toString("hex");
}

/**
 * Fetches the WASM hash a deployed contract currently runs.
 */
export async function fetchOnChainHash(
  server: HashFetcher,
  contractId: string,
): Promise<string | undefined> {
  const footprint = new Contract(contractId).getFootprint();
  const response = await server.getLedgerEntries(footprint);

  const entry = response.entries?.[0];
  if (!entry) return undefined;

  return extractOnChainHash(entry.val);
}

/**
 * Diffs a local build artifact against the WASM hash a deployed contract runs.
 */
export async function verifyHash(
  server: HashFetcher,
  name: string,
  contractId: string | undefined,
  wasmPath: string | undefined,
): Promise<HashComparison> {
  if (!contractId) {
    return {
      name,
      wasmPath,
      verdict: "invalid",
      error: "No contractId configured",
    };
  }
  if (!wasmPath) {
    return {
      name,
      contractId,
      verdict: "invalid",
      error: "No local WASM path provided",
    };
  }

  let localHash: string;
  try {
    localHash = hashLocalWasm(wasmPath);
  } catch (err: any) {
    return {
      name,
      contractId,
      wasmPath,
      verdict: "missing_local",
      error: `Could not read local WASM: ${err.message}`,
    };
  }

  let onChainHash: string | undefined;
  try {
    onChainHash = await fetchOnChainHash(server, contractId);
  } catch (err: any) {
    return {
      name,
      contractId,
      wasmPath,
      localHash,
      verdict: "invalid",
      error: err.message,
    };
  }

  if (!onChainHash) {
    return {
      name,
      contractId,
      wasmPath,
      localHash,
      verdict: "missing_onchain",
      error: "No WASM hash found on-chain for this contract",
    };
  }

  return {
    name,
    contractId,
    wasmPath,
    localHash,
    onChainHash,
    verdict: localHash === onChainHash ? "match" : "mismatch",
  };
}

/**
 * Builds the `verify-hash` command.
 */
export function createVerifyHashCommand(): Command {
  const cmd = new Command("verify-hash")
    .description(
      "Diff a local WASM build against the hash a deployed contract runs",
    )
    .requiredOption("--wasm <path>", "Path to the locally built .wasm artifact")
    .option(
      "--contract-id <id>",
      "Contract id or deployment alias (defaults to the configured contract)",
    )
    .option("--name <name>", "Label for the contract in the report", "contract")
    .option("--json", "Print the local and on-chain hashes as JSON");

  addNetworkOptions(cmd);

  cmd.action(async (options, command) => {
    try {
      const clientConfig = getClientConfig(explicitNetworkOverrides(command));
      const contractId = options.contractId
        ? resolveContractIdOption(command, options.contractId)
        : clientConfig.contractId;

      logger.debug(`Verifying ${options.wasm} against ${contractId}`);

      const server = new SorobanRpc.Server(clientConfig.rpcUrl, {
        allowHttp: clientConfig.rpcUrl.startsWith("http://"),
      });
      const result = await verifyHash(
        server,
        options.name,
        contractId,
        options.wasm,
      );

      if (options.json) {
        writeJson(result);
      } else {
        if (result.localHash) logger.info(`Local hash:    ${result.localHash}`);
        if (result.onChainHash)
          logger.info(`On-chain hash: ${result.onChainHash}`);
      }

      if (result.verdict === "match") {
        if (!options.json) {
          logger.success(
            `${result.name}: local build matches the deployed contract`,
          );
        }
      } else {
        logger.error(
          `${result.name}: ${result.verdict}${result.error ? ` - ${result.error}` : ""}`,
        );
        process.exitCode = 1;
      }
    } catch (err: any) {
      logger.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

  return cmd;
}
