import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProgram } from "../parseArgs.js";

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("CLI TypeScript project structure (#683)", () => {
  it("builds a commander.js program named bc-forge", () => {
    const program = buildProgram();
    expect(program).toBeInstanceOf(Command);
    expect(program.name()).toBe("bc-forge");
    expect(program.version()).toBe("0.1.0");
    expect(program.description()).toMatch(/deployment orchestrator/i);
  });

  it("registers the deployment subcommands", () => {
    const names = buildProgram().commands.map((cmd) => cmd.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "upgrade",
        "smoke-test",
        "check-status",
        "verify-hash",
        "generate-bindings",
        "deploy",
        "init-superadmin",
        "connect",
        "orchestrate",
      ])
    );
  });

  it("declares commander as a runtime dependency and a bin entrypoint", () => {
    const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf-8"));
    expect(pkg.type).toBe("module");
    expect(pkg.bin["bc-forge"]).toBe("./dist/index.js");
    expect(pkg.dependencies.commander).toBeDefined();
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.start).toBeDefined();
  });

  it("exposes a node shebang entrypoint that boots parseArgs", () => {
    const entry = readFileSync(join(cliRoot, "src/index.ts"), "utf-8");
    expect(entry.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(entry).toContain("parseArgs");
  });
});
