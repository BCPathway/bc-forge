import { describe, it, expect } from "vitest";
import { Command } from "commander";
import {
  NETWORK_PRESETS,
  NETWORK_CHOICES,
  parseNetworkName,
  resolveNetworkConfig,
  addNetworkOptions,
  mergeNetworkOptions,
  explicitNetworkOverrides,
  UnknownNetworkError,
  InvalidRpcUrlError,
} from "../network.js";

describe("CLI network selection (#684)", () => {
  describe("parseNetworkName", () => {
    it("accepts testnet, mainnet, and local", () => {
      expect(parseNetworkName("testnet")).toBe("testnet");
      expect(parseNetworkName("mainnet")).toBe("mainnet");
      expect(parseNetworkName("local")).toBe("local");
    });

    it("normalizes case and aliases used by Stellar CLI / config files", () => {
      expect(parseNetworkName("TestNet")).toBe("testnet");
      expect(parseNetworkName("pubnet")).toBe("mainnet");
      expect(parseNetworkName("public")).toBe("mainnet");
      expect(parseNetworkName("standalone")).toBe("local");
    });

    it("rejects unknown network names", () => {
      expect(() => parseNetworkName("devnet")).toThrow(UnknownNetworkError);
      expect(() => parseNetworkName("devnet")).toThrow(/Supported networks: testnet, mainnet, local/);
    });

    it("rejects empty network names", () => {
      expect(() => parseNetworkName("")).toThrow(UnknownNetworkError);
      expect(() => parseNetworkName("   ")).toThrow(UnknownNetworkError);
    });
  });

  describe("resolveNetworkConfig", () => {
    it("defaults to testnet RPC URL and passphrase", () => {
      expect(resolveNetworkConfig()).toEqual(NETWORK_PRESETS.testnet);
    });

    it("maps testnet to the public Soroban testnet RPC", () => {
      expect(resolveNetworkConfig({ network: "testnet" })).toEqual({
        name: "testnet",
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
      });
    });

    it("maps mainnet to the public Soroban mainnet RPC", () => {
      expect(resolveNetworkConfig({ network: "mainnet" })).toEqual({
        name: "mainnet",
        rpcUrl: "https://mainnet.sorobanrpc.com",
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      });
    });

    it("maps local to the standalone quickstart RPC", () => {
      expect(resolveNetworkConfig({ network: "local" })).toEqual({
        name: "local",
        rpcUrl: "http://localhost:8000/soroban/rpc",
        networkPassphrase: "Standalone Network ; February 2017",
      });
    });

    it("lets --rpc-url override the network preset", () => {
      const resolved = resolveNetworkConfig({
        network: "mainnet",
        rpcUrl: "https://rpc.example.test",
      });
      expect(resolved.name).toBe("mainnet");
      expect(resolved.rpcUrl).toBe("https://rpc.example.test");
      expect(resolved.networkPassphrase).toBe(NETWORK_PRESETS.mainnet.networkPassphrase);
    });

    it("lets --network-passphrase override the network preset", () => {
      const resolved = resolveNetworkConfig({
        network: "local",
        networkPassphrase: "Custom Network ; January 2026",
      });
      expect(resolved.rpcUrl).toBe(NETWORK_PRESETS.local.rpcUrl);
      expect(resolved.networkPassphrase).toBe("Custom Network ; January 2026");
    });

    it("rejects invalid RPC URL overrides", () => {
      expect(() =>
        resolveNetworkConfig({ network: "testnet", rpcUrl: "not-a-url" })
      ).toThrow(InvalidRpcUrlError);
      expect(() =>
        resolveNetworkConfig({ rpcUrl: "ftp://rpc.example" })
      ).toThrow(/http:\/\/ or https:\/\//);
    });

    it("rejects unknown networks even when an RPC URL is supplied", () => {
      expect(() =>
        resolveNetworkConfig({
          network: "devnet",
          rpcUrl: "https://rpc.example.test",
        })
      ).toThrow(UnknownNetworkError);
    });
  });

  describe("addNetworkOptions / mergeNetworkOptions", () => {
    it("exposes the supported network choices on a command", () => {
      const cmd = addNetworkOptions(new Command("demo"), { withDefault: true });
      const help = cmd.helpInformation();
      expect(help).toContain("--network");
      expect(help).toContain("--rpc-url");
      expect(help).toContain("--network-passphrase");
      for (const name of NETWORK_CHOICES) {
        expect(help).toContain(name);
      }
    });

    it("prefers subcommand flags over parent flags", () => {
      const parent = addNetworkOptions(new Command("bc-forge"), { withDefault: true });
      const child = addNetworkOptions(parent.command("upgrade"));

      parent.setOptionValue("network", "testnet");
      parent.setOptionValue("rpcUrl", "https://parent.example");
      child.setOptionValue("network", "local");

      const merged = mergeNetworkOptions(child);
      expect(merged.network).toBe("local");
      expect(merged.rpcUrl).toBe("https://parent.example");
    });

    it("reports only flags that were passed on the CLI", () => {
      const parent = addNetworkOptions(new Command("bc-forge"), { withDefault: true });
      const child = addNetworkOptions(parent.command("upgrade"));

      child.setOptionValueWithSource("network", "mainnet", "cli");
      child.setOptionValueWithSource("rpcUrl", NETWORK_PRESETS.testnet.rpcUrl, "default");

      expect(explicitNetworkOverrides(child)).toEqual({
        network: "mainnet",
        rpcUrl: undefined,
        networkPassphrase: undefined,
      });
    });
  });
});
