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
      expect(output).toContain("--network");
      expect(output).toContain("--rpc-url");
    });
  });

  describe("global --network flags (#684)", () => {
    it("defaults upgrade to testnet RPC when --rpc-url is omitted", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;
      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv("upgrade", "--wasm", "./token.wasm", "--contract-id", "CABC123", "--source", "S...")
      );

      expect(parsedOpts.network).toBe("testnet");
      expect(parsedOpts.rpcUrl).toBe("https://soroban-testnet.stellar.org");
      expect(parsedOpts.networkPassphrase).toBe("Test SDF Network ; September 2015");
    });

    it("maps --network mainnet to mainnet RPC and passphrase", async () => {
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
          "--network",
          "mainnet",
          "--wasm",
          "./token.wasm",
          "--contract-id",
          "CABC123",
          "--source",
          "S..."
        )
      );

      expect(parsedOpts.network).toBe("mainnet");
      expect(parsedOpts.rpcUrl).toBe("https://mainnet.sorobanrpc.com");
      expect(parsedOpts.networkPassphrase).toBe(
        "Public Global Stellar Network ; September 2015"
      );
    });

    it("maps a global --network local flag placed before the subcommand", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;
      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv(
          "--network",
          "local",
          "upgrade",
          "--wasm",
          "./token.wasm",
          "--contract-id",
          "CABC123",
          "--source",
          "S..."
        )
      );

      expect(parsedOpts.network).toBe("local");
      expect(parsedOpts.rpcUrl).toBe("http://localhost:8000/soroban/rpc");
      expect(parsedOpts.networkPassphrase).toBe("Standalone Network ; February 2017");
    });

    it("lets --rpc-url override the selected network preset", async () => {
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
          "--network",
          "mainnet",
          "--rpc-url",
          "https://rpc.example.test",
          "--contract-id",
          "CABC123",
          "--source",
          "S..."
        )
      );

      expect(parsedOpts.network).toBe("mainnet");
      expect(parsedOpts.rpcUrl).toBe("https://rpc.example.test");
      expect(parsedOpts.networkPassphrase).toBe(
        "Public Global Stellar Network ; September 2015"
      );
    });

    it("rejects an unsupported --network value", async () => {
      const program = buildProgram();
      program.configureOutput({ writeErr: () => {} });

      await expect(
        program.parseAsync(
          argv(
            "upgrade",
            "--network",
            "devnet",
            "--wasm",
            "./token.wasm",
            "--contract-id",
            "CABC123",
            "--source",
            "S..."
          )
        )
      ).rejects.toThrow();
    });

    it("rejects an invalid --rpc-url override", async () => {
      const program = buildProgram();
      program.configureOutput({ writeErr: () => {} });

      await expect(
        program.parseAsync(
          argv(
            "upgrade",
            "--rpc-url",
            "not-a-url",
            "--wasm",
            "./token.wasm",
            "--contract-id",
            "CABC123",
            "--source",
            "S..."
          )
        )
      ).rejects.toThrow(/Invalid RPC URL/);
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

    it("does not require --rpc-url when --network can supply it", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;
      program.commands
        .find((c) => c.name() === "upgrade")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv("upgrade", "--wasm", "./artifacts/token.wasm", "--contract-id", "CX", "--source", "S...")
      );

      expect(parsedOpts).not.toBeNull();
      expect(parsedOpts.rpcUrl).toBe("https://soroban-testnet.stellar.org");
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
      expect(output).toContain("--network");
      expect(output).toContain("--source");
      expect(output).toContain("--estimate");
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

    it("accepts --estimate flag", async () => {
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
          "--estimate"
        )
      );

      expect(parsedOpts.estimate).toBe(true);
    });

    it("defaults --estimate to false", async () => {
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

      expect(parsedOpts.estimate).toBe(false);
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

    it("does not require --rpc-url when --network can supply it", async () => {
      const program = buildProgram();
      let parsedOpts: any = null;
      program.commands
        .find((c) => c.name() === "smoke-test")!
        .action(async (opts) => {
          parsedOpts = opts;
        });

      await program.parseAsync(
        argv("smoke-test", "--contract-id", "CX", "--source", "S...")
      );

      expect(parsedOpts).not.toBeNull();
      expect(parsedOpts.rpcUrl).toBe("https://soroban-testnet.stellar.org");
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
      expect(output).toContain("--network");
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

  describe("malformed config handling", () => {
    it("getFileConfig handles missing config file gracefully", async () => {
      const { getFileConfig } = await import('../utils/config.js');
      
      // Temporarily change cwd to ensure no config exists
      const originalCwd = process.cwd();
      const tmpDir = (await import('node:os')).tmpdir();
      
      try {
        process.chdir(tmpDir);
        const config = getFileConfig();
        // Should return undefined when config doesn't exist (not throw)
        expect(config).toBeUndefined();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it("validates config structure on load - detailed error messages", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'malformed-config-'));
      
      try {
        // Test missing required fields
        const invalidConfigPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(invalidConfigPath, JSON.stringify({
          symbol: 'TEST'
          // missing required "name" field
        }));

        const result = loadConfigFile(invalidConfigPath);
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
        expect(result.errors!.some(e => e.toLowerCase().includes('name'))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("reports invalid JSON in config file with details", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-json-'));
      
      try {
        const invalidJsonPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(invalidJsonPath, '{ "name": "test", invalid json }');

        const result = loadConfigFile(invalidJsonPath);
        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('Invalid JSON syntax');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("validates Stellar address formats in config", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stellar-addr-'));
      
      try {
        const badAdminPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(badAdminPath, JSON.stringify({
          name: 'Test Token',
          symbol: 'TST',
          admin: 'NOTAVALIDADDRESS'  // Invalid Stellar address
        }));

        const result = loadConfigFile(badAdminPath);
        expect(result.success).toBe(false);
        expect(result.errors?.some(e => e.toLowerCase().includes('admin'))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("validates network enum values in config", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'network-enum-'));
      
      try {
        const badNetworkPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(badNetworkPath, JSON.stringify({
          name: 'Test Token',
          symbol: 'TST',
          network: 'invalid-network'
        }));

        const result = loadConfigFile(badNetworkPath);
        expect(result.success).toBe(false);
        expect(result.errors?.some(e => e.toLowerCase().includes('network'))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("validates decimals range (0-18) in config", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decimals-'));
      
      try {
        // Test decimals > 18
        const tooHighPath = path.join(tmpDir, 'too-high.json');
        fs.writeFileSync(tooHighPath, JSON.stringify({
          name: 'Test Token',
          symbol: 'TST',
          decimals: 19
        }));

        const result1 = loadConfigFile(tooHighPath);
        expect(result1.success).toBe(false);
        
        // Test negative decimals
        const negativePath = path.join(tmpDir, 'negative.json');
        fs.writeFileSync(negativePath, JSON.stringify({
          name: 'Test Token',
          symbol: 'TST',
          decimals: -1
        }));

        const result2 = loadConfigFile(negativePath);
        expect(result2.success).toBe(false);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("rejects config with wrong data types", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-mismatch-'));
      
      try {
        const typeMismatchPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(typeMismatchPath, JSON.stringify({
          name: 'Test Token',
          symbol: 'TST',
          decimals: 'not-a-number'  // Should be integer
        }));

        const result = loadConfigFile(typeMismatchPath);
        expect(result.success).toBe(false);
        expect(result.errors?.some(e => 
          e.toLowerCase().includes('decimals') || e.toLowerCase().includes('type')
        )).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles empty config file", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-config-'));
      
      try {
        const emptyPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(emptyPath, '');

        const result = loadConfigFile(emptyPath);
        expect(result.success).toBe(false);
        expect(result.errors?.[0]).toContain('Invalid JSON syntax');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("handles config as JSON array instead of object", async () => {
      const { loadConfigFile } = await import('../utils/config-parser.js');
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'array-config-'));
      
      try {
        const arrayPath = path.join(tmpDir, '.bc-forge.json');
        fs.writeFileSync(arrayPath, '["name", "symbol"]');

        const result = loadConfigFile(arrayPath);
        expect(result.success).toBe(false);
        expect(result.errors?.length).toBeGreaterThan(0);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
