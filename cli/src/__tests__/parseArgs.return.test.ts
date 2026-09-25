import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseArgs } from "../parseArgs.js";

/**
 * Regression tests for the `parseArgs` return contract (#350).
 *
 * `parseArgs` was declared `Promise<any>` and documented as returning "the
 * parsed options", but its body was `await program.parseAsync(argv);` with no
 * `return` — so a caller doing `const opts = await parseArgs()` always got
 * `undefined`, whatever arguments the user supplied. Nothing consumed the
 * value yet, which is why it went unnoticed.
 *
 * These tests assert on the value a caller actually receives.
 */

// Commander exits the process for --help / --version; keep the runner alive.
function stubExit() {
  return vi.spyOn(process, "exit").mockImplementation((() => {
    throw new Error("process.exit called");
  }) as never);
}

function quietParseArgs(argv: string[]) {
  return parseArgs(["node", "bc-forge", ...argv]);
}

describe("parseArgs return contract (#350)", () => {
  let exitSpy: ReturnType<typeof stubExit>;

  beforeEach(() => {
    exitSpy = stubExit();
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("returns the resolved options of the invoked subcommand", async () => {
    const opts = await quietParseArgs(["smoke-test", "--contract-id", "CABC123", "--source", "S..."]);
    expect(opts).toBeDefined();
    expect(opts!.contractId).toBe("CABC123");
    expect(opts!.source).toBe("S...");
    expect(opts!.amount).toBe("1");
  });

  it("returns committed defaults, not just the flags the caller passed", async () => {
    const opts = await quietParseArgs(["upgrade", "--wasm", "./token.wasm", "--contract-id", "CX", "--source", "S..."]);
    expect(opts).toBeDefined();
    expect(opts!.estimate).toBe(false);
    expect(opts!.dryRun).toBe(false);
  });

  it("reflects an explicit boolean flag", async () => {
    const opts = await quietParseArgs([
      "upgrade",
      "--wasm",
      "./token.wasm",
      "--contract-id",
      "CX",
      "--source",
      "S...",
      "--dry-run",
    ]);
    expect(opts!.dryRun).toBe(true);
  });

  it("reflects a negated network preset resolved for the subcommand", async () => {
    const opts = await quietParseArgs(["upgrade", "--network", "mainnet", "--wasm", "./t.wasm", "--contract-id", "CX", "--source", "S..."]);
    expect(opts!.network).toBe("mainnet");
    expect(opts!.networkPassphrase).toBe("Public Global Stellar Network ; September 2015");
  });

  it("returns undefined when no subcommand ran", async () => {
    // --version prints and exits; there is no command whose options to report
    const opts = await quietParseArgs(["--version"]).catch(() => "threw");
    expect(opts === undefined || opts === "threw").toBe(true);
  });

  it("does not silently swallow a parse error", async () => {
    await expect(
      quietParseArgs(["upgrade", "--network", "devnet", "--wasm", "./t.wasm", "--contract-id", "CX", "--source", "S..."]),
    ).rejects.toThrow();
  });
});
