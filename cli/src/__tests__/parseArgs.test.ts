import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildProgram } from "../parseArgs.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function argv(...args: string[]): string[] {
  return ["node", "bc-forge", ...args];
}

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("CLI Parser (#705)", () => {
  // Commander calls process.exit(0) for --version and --help
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalExit = process.exit;
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.exit = originalExit;
  });

  describe("top-level program", () => {
    it("prints version with --version", () => {
      const program = buildProgram();
      const output = program.helpInformation();
      // --version is handled before help output, but we can verify version is set
      expect(program.version()).toContain("0.1.0");
    });

    it("prints help with --help", () => {
      const program = buildProgram();
      const output = program.helpInformation();
      expect(output).toContain("upgrade");
      expect(output).toContain("smoke-test");
    });
  });

  describe("upgrade command", () => {
    it("rejects when --wasm is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("upgrade", "--contract-id", "CX", "--rpc-url", "http://localhost", "--source", "S...")
        )
      ).rejects.toThrow();
    });

    it("rejects when --contract-id is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("upgrade", "--wasm", "./artifacts/token.wasm", "--rpc-url", "http://localhost", "--source", "S...")
        )
      ).rejects.toThrow();
    });

    it("rejects when --rpc-url is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("upgrade", "--wasm", "./artifacts/token.wasm", "--contract-id", "CX", "--source", "S...")
        )
      ).rejects.toThrow();
    });

    it("rejects when --source is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("upgrade", "--wasm", "./artifacts/token.wasm", "--contract-id", "CX", "--rpc-url", "http://localhost")
        )
      ).rejects.toThrow();
    });

    it("shows upgrade help with --help", () => {
      const program = buildProgram();
      const upgradeCmd = program.commands.find((c) => c.name() === "upgrade");
      expect(upgradeCmd).toBeDefined();
      const output = upgradeCmd!.helpInformation();
      expect(output).toContain("--wasm");
      expect(output).toContain("--contract-id");
      expect(output).toContain("--rpc-url");
      expect(output).toContain("--source");
    });

    it("accepts all required flags with defaults", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;

      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "upgrade",
          "--wasm",
          "./token.wasm",
          "--contract-id",
          "CABC123",
          "--rpc-url",
          "https://soroban-testnet.stellar.org",
          "--source",
          "S..."
        )
      );

      expect(parsedOpts).not.toBeNull();
      expect(parsedOpts.wasm).toBe("./token.wasm");
      expect(parsedOpts.contractId).toBe("CABC123");
      expect(parsedOpts.rpcUrl).toBe("https://soroban-testnet.stellar.org");
      expect(parsedOpts.source).toBe("S...");
    });

    it("uses default network passphrase", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;

      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "upgrade",
          "--wasm",
          "./token.wasm",
          "--contract-id",
          "CABC123",
          "--rpc-url",
          "http://localhost",
          "--source",
          "S..."
        )
      );

      expect(parsedOpts.networkPassphrase).toBe(
        "Test SDF Network ; September 2015"
      );
    });

    it("accepts custom network passphrase", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;

      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "upgrade",
          "--wasm",
          "./token.wasm",
          "--contract-id",
          "CABC123",
          "--rpc-url",
          "http://localhost",
          "--source",
          "S...",
          "--network-passphrase",
          "Public Global Stellar Network ; September 2015"
        )
      );

      expect(parsedOpts.networkPassphrase).toBe(
        "Public Global Stellar Network ; September 2015"
      );
    });

    it("accepts --dry-run flag", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;

      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "upgrade",
          "--wasm",
          "./token.wasm",
          "--contract-id",
          "CABC123",
          "--rpc-url",
          "http://localhost",
          "--source",
          "S...",
          "--dry-run"
        )
      );

      expect(parsedOpts.dryRun).toBe(true);
    });
  });

  describe("smoke-test command", () => {
    it("rejects when --contract-id is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("smoke-test", "--rpc-url", "http://localhost", "--source", "S...")
        )
      ).rejects.toThrow();
    });

    it("rejects when --rpc-url is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("smoke-test", "--contract-id", "CX", "--source", "S...")
        )
      ).rejects.toThrow();
    });

    it("rejects when --source is missing", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(
          argv("smoke-test", "--contract-id", "CX", "--rpc-url", "http://localhost")
        )
      ).rejects.toThrow();
    });

    it("shows smoke-test help with --help", () => {
      const program = buildProgram();
      const smokeCmd = program.commands.find((c) => c.name() === "smoke-test");
      expect(smokeCmd).toBeDefined();
      const output = smokeCmd!.helpInformation();
      expect(output).toContain("--contract-id");
      expect(output).toContain("--rpc-url");
      expect(output).toContain("--source");
      expect(output).toContain("--recipient");
      expect(output).toContain("--amount");
    });

    it("accepts all required flags with defaults", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;

      program.commands
        .find((c) => c.name() === "smoke-test")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "smoke-test",
          "--contract-id",
          "CABC123",
          "--rpc-url",
          "https://soroban-testnet.stellar.org",
          "--source",
          "S..."
        )
      );

      expect(parsedOpts).not.toBeNull();
      expect(parsedOpts.contractId).toBe("CABC123");
      expect(parsedOpts.rpcUrl).toBe("https://soroban-testnet.stellar.org");
      expect(parsedOpts.source).toBe("S...");
      expect(parsedOpts.amount).toBe("1");
    });

    it("accepts optional --recipient and --amount", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;

      program.commands
        .find((c) => c.name() === "smoke-test")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "smoke-test",
          "--contract-id",
          "CABC123",
          "--rpc-url",
          "http://localhost",
          "--source",
          "S...",
          "--recipient",
          "GABC...",
          "--amount",
          "100"
        )
      );

      expect(parsedOpts.recipient).toBe("GABC...");
      expect(parsedOpts.amount).toBe("100");
    });
  });

  describe("unknown commands", () => {
    it("rejects unknown subcommands", async () => {
      const program = buildProgram();
      const stderr: string[] = [];
      program.configureOutput({
        writeErr: (str) => stderr.push(str),
      });

      await expect(
        program.parseAsync(argv("nonexistent-cmd"))
      ).rejects.toThrow();
    });
  });
});
