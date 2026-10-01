// SPDX-License-Identifier: MIT
import { describe, it, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProgram } from "../parseArgs.js";
import { registerDeploymentAlias } from "../utils/registry.js";
import logger from "../utils/logger.js";
import { COMPLETION_SHELLS } from "../commands/completions.js";

const TESTNET_ID = `C${"A".repeat(55)}`;

describe("--json output and shell completions (#941)", () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints parseable JSON for deployments resolve --json", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bc-forge-json-"));
    const registryPath = path.join(dir, "deployments.json");
    registerDeploymentAlias({
      alias: "token",
      contractId: TESTNET_ID,
      network: "testnet",
      filePath: registryPath,
    });

    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    try {
      await buildProgram().parseAsync([
        "node",
        "bc-forge",
        "deployments",
        "resolve",
        "token",
        "--network",
        "testnet",
        "--file",
        registryPath,
        "--json",
      ]);

      expect(JSON.parse(stdout)).toEqual({
        contractId: TESTNET_ID,
        network: "testnet",
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(COMPLETION_SHELLS)("prints a non-empty %s completion script", async (shell) => {
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await buildProgram().parseAsync(["node", "bc-forge", "completions", shell]);

    expect(stdout.trim().length).toBeGreaterThan(0);
    expect(stdout).toContain("bc-forge");
    expect(stdout).toContain("deployments");
  });

  it("reports an unsupported shell on stderr", async () => {
    const errors: string[] = [];
    vi.spyOn(logger, "error").mockImplementation((message: string) => {
      errors.push(message);
    });
    let stdout = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });

    await buildProgram().parseAsync(["node", "bc-forge", "completions", "powershell"]);

    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toContain("powershell");
    expect(stdout).toBe("");
  });
});
