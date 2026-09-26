import { Command } from "commander";
import logger from "../utils/logger.js";
import { resolveContractIdOption } from "../utils/registry.js";
import { initializeSuperAdmin } from "../orchestrator/init-superadmin.js";
import { connectContractIds } from "../orchestrator/connect-contracts.js";
import { runDeploymentOrchestrator } from "../orchestrator/orchestrator.js";

function resolveId(command: Command, value: string | undefined): string | undefined {
  return resolveContractIdOption(command, value);
}

export function createInitSuperAdminCommand(): Command {
  return new Command("init-superadmin")
    .description("Initialize contract natively with deployer as SuperAdmin and verify on-chain")
    .option("--contract-id <string>", "Contract ID or deployment alias to initialize")
    .option("--deployer <string>", "Deployer Stellar public key (G...)")
    .option("--secret-key <string>", "Deployer secret key (S...)")
    .option("--name <string>", "Token name")
    .option("--symbol <string>", "Token symbol")
    .option("--decimals <number>", "Decimal places")
    .option("--no-verify", "Skip on-chain SuperAdmin verification")
    .action(async (options, command: Command) => {
      try {
        const result = await initializeSuperAdmin({
          contractId: resolveId(command, options.contractId),
          deployer: options.deployer,
          secretKey: options.secretKey,
          name: options.name,
          symbol: options.symbol,
          decimals: options.decimals ? parseInt(options.decimals, 10) : undefined,
          verify: options.verify,
        });
        if (!result.success) {
          logger.error(`Failed to initialize SuperAdmin: ${result.error}`);
          process.exitCode = 1;
        }
      } catch (err: any) {
        logger.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}

export function createConnectCommand(): Command {
  return new Command("connect")
    .alias("link")
    .description("Connect deployed contract IDs post-deployment")
    .option("--admin <string>", "Admin contract ID or deployment alias")
    .option("--token <string>", "Token contract ID or deployment alias")
    .option("--vesting <string>", "Vesting contract ID or deployment alias")
    .option("--wrapper <string>", "Wrapper contract ID or deployment alias")
    .option("--secret-key <string>", "Deployer secret key")
    .option("--file [file]", "Path to .bc-forge.json")
    .action(async (options, command: Command) => {
      try {
        const result = await connectContractIds({
          adminContractId: resolveId(command, options.admin),
          tokenContractId: resolveId(command, options.token),
          vestingContractId: resolveId(command, options.vesting),
          wrapperContractId: resolveId(command, options.wrapper),
          secretKey: options.secretKey,
          configPath: options.file,
        });
        if (!result.success) {
          logger.error("Failed to connect contract IDs:");
          result.errors?.forEach((err) => logger.error(`  - ${err}`));
          process.exitCode = 1;
        }
      } catch (err: any) {
        logger.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}

export function createOrchestrateCommand(): Command {
  return new Command("orchestrate")
    .description("Run full deployment orchestrator: initialize SuperAdmin and connect contract IDs")
    .option("--admin <string>", "Admin contract ID or deployment alias")
    .option("--token <string>", "Token contract ID or deployment alias")
    .option("--vesting <string>", "Vesting contract ID or deployment alias")
    .option("--wrapper <string>", "Wrapper contract ID or deployment alias")
    .option("--name <string>", "Token name")
    .option("--symbol <string>", "Token symbol")
    .option("--decimals <number>", "Token decimals")
    .option("--secret-key <string>", "Deployer secret key")
    .option("--file [file]", "Path to .bc-forge.json")
    .option("--skip-verify", "Skip on-chain verification steps")
    .action(async (options, command: Command) => {
      try {
        const result = await runDeploymentOrchestrator({
          adminContractId: resolveId(command, options.admin),
          tokenContractId: resolveId(command, options.token),
          vestingContractId: resolveId(command, options.vesting),
          wrapperContractId: resolveId(command, options.wrapper),
          name: options.name,
          symbol: options.symbol,
          decimals: options.decimals ? parseInt(options.decimals, 10) : undefined,
          secretKey: options.secretKey,
          configPath: options.file,
          skipVerify: options.skipVerify,
        });
        if (!result.success) {
          logger.error("Orchestration encountered errors.");
          process.exitCode = 1;
        }
      } catch (err: any) {
        logger.error(`Error: ${err.message}`);
        process.exitCode = 1;
      }
    });
}
