// SPDX-License-Identifier: MIT
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { resolveConfigFileOption } from "../commands/orchestrator.js";
import {
  defaultConfigPath,
  DEFAULT_CONFIG_FILENAME,
} from "../utils/config-parser.js";
import { connectContractIds } from "../orchestrator/connect-contracts.js";
import { initializeSuperAdmin } from "../orchestrator/init-superadmin.js";
import * as configUtil from "../utils/config.js";

const TOKEN_ID = `C${"A".repeat(54)}C`;
const ADMIN_ID = `C${"A".repeat(54)}B`;

describe("orchestrator --file resolution (follow-up to #1129)", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("defaults to ./.bc-forge.json when --file is omitted", () => {
    expect(resolveConfigFileOption(undefined)).toBe(defaultConfigPath());
    expect(resolveConfigFileOption(undefined)).toBe(
      path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME),
    );
  });

  it("treats a bare --file (commander passes true) as the default path", () => {
    expect(resolveConfigFileOption(true)).toBe(defaultConfigPath());
    expect(resolveConfigFileOption("")).toBe(defaultConfigPath());
  });

  it("keeps an explicit --file value as given", () => {
    expect(resolveConfigFileOption("deploy/testnet.json")).toBe(
      "deploy/testnet.json",
    );
  });

  it("CLI usage creates a missing .bc-forge.json when given the explicit default path", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-orch-"));
    const configPath = defaultConfigPath(tmpDir);
    expect(fs.existsSync(configPath)).toBe(false);

    const result = await connectContractIds({
      adminContractId: ADMIN_ID,
      tokenContractId: TOKEN_ID,
      deployerKeypair: Keypair.random(),
      configPath,
    });

    expect(result.success).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved.contracts.token.adminContractId).toBe(ADMIN_ID);
  });

  it("library usage without configPath does not create a file in the working directory", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-orch-"));
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpDir);
    vi.spyOn(configUtil, "getClientConfig").mockReturnValue({
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
      contractId: "",
    });

    const keypair = Keypair.random();
    await connectContractIds({
      adminContractId: ADMIN_ID,
      tokenContractId: TOKEN_ID,
      deployerKeypair: keypair,
    });
    await initializeSuperAdmin({
      contractId: TOKEN_ID,
      deployerKeypair: keypair,
      verify: false,
    });

    expect(fs.existsSync(defaultConfigPath(tmpDir))).toBe(false);
    cwdSpy.mockRestore();
  });
});
