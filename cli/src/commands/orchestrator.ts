import { Command } from "commander";
import logger from "../utils/logger.js";
import { initializeSuperAdmin } from "../orchestrator/init-superadmin.js";
import { connectContractIds } from "../orchestrator/connect-contracts.js";
import { runDeploymentOrchestrator } from "../orchestrator/orchestrator.js";

export function createInitSuperAdminCommand(): Command {
  return new Command("init-superadmin")
    .description("Initialize contract natively with deployer as SuperAdmin and verify on-chain")
    .option("--contract-id <string>", "Contract ID to initialize")
    .option("--deployer <string>", "Deployer Stellar public key (G...)")
    .option("--secret-key <string>", "Deployer secret key (S...)")
    .option("--name <string>", "Token name")
    .option("--symbol <string>", "Token symbol")
    .option("--decimals <number>", "Decimal places")
    .option("--no-verify", "Skip on-chain SuperAdmin verification")
    .action(async (options) => {
      try {
        const result = await initializeSuperAdmin({
          contractId: options.contractId,
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
    .option("--admin <string>", "Admin Contract ID")
    .option("--token <string>", "Token Contract ID")
    .option("--vesting <string>", "Vesting Contract ID")
    .option("--wrapper <string>", "Wrapper Contract ID")
    .option("--secret-key <string>", "Deployer secret key")
    .option("--file [file]", "Path to .bc-forge.json")
    .action(async (options) => {
      try {
        const result = await connectContractIds({
          adminContractId: options.admin,
          tokenContractId: options.token,
          vestingContractId: options.vesting,
          wrapperContractId: options.wrapper,
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
    .option("--admin <string>", "Admin Contract ID")
    .option("--token <string>", "Token Contract ID")
    .option("--vesting <string>", "Vesting Contract ID")
    .option("--wrapper <string>", "Wrapper Contract ID")
    .option("--name <string>", "Token name")
    .option("--symbol <string>", "Token symbol")
    .option("--decimals <number>", "Token decimals")
    .option("--secret-key <string>", "Deployer secret key")
    .option("--file [file]", "Path to .bc-forge.json")
    .option("--skip-verify", "Skip on-chain verification steps")
    .action(async (options) => {
      try {
        const result = await runDeploymentOrchestrator({
          adminContractId: options.admin,
          tokenContractId: options.token,
          vestingContractId: options.vesting,
          wrapperContractId: options.wrapper,
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
