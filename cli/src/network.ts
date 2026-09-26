import { Command, Option } from "commander";

/**
 * Networks exposed by the CLI `--network` flag.
 *
 * Aliases (`pubnet`, `standalone`) are accepted by {@link parseNetworkName}
 * so config files and env vars can use Stellar CLI naming.
 */
export const NETWORK_CHOICES = ["testnet", "mainnet", "local"] as const;
export type NetworkName = (typeof NETWORK_CHOICES)[number];

export interface NetworkPreset {
  name: NetworkName;
  rpcUrl: string;
  networkPassphrase: string;
}

export interface NetworkOverrides {
  network?: string;
  rpcUrl?: string;
  networkPassphrase?: string;
}

export interface ResolvedNetworkConfig {
  name: NetworkName;
  rpcUrl: string;
  networkPassphrase: string;
}

/**
 * Default RPC URLs and passphrases, matching Stellar CLI network presets.
 */
export const NETWORK_PRESETS: Record<NetworkName, NetworkPreset> = {
  testnet: {
    name: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    name: "mainnet",
    rpcUrl: "https://mainnet.sorobanrpc.com",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
  local: {
    name: "local",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
  },
};

const NETWORK_ALIASES: Record<string, NetworkName> = {
  testnet: "testnet",
  mainnet: "mainnet",
  pubnet: "mainnet",
  public: "mainnet",
  local: "local",
  standalone: "local",
};

export class UnknownNetworkError extends Error {
  constructor(public readonly network: string) {
    const label = network.trim() === "" ? "(empty)" : network;
    super(
      `Unknown network "${label}". Supported networks: ${NETWORK_CHOICES.join(", ")}.`
    );
    this.name = "UnknownNetworkError";
  }
}

export class InvalidRpcUrlError extends Error {
  constructor(public readonly rpcUrl: string) {
    super(
      `Invalid RPC URL "${rpcUrl}". Expected an http:// or https:// URL.`
    );
    this.name = "InvalidRpcUrlError";
  }
}

export function isNetworkName(value: string): value is NetworkName {
  return (NETWORK_CHOICES as readonly string[]).includes(value);
}

/**
 * Normalize a user-supplied network name (flag, env, or config) to a preset.
 */
export function parseNetworkName(value: string): NetworkName {
  if (typeof value !== "string" || value.trim() === "") {
    throw new UnknownNetworkError(value ?? "");
  }

  const mapped = NETWORK_ALIASES[value.trim().toLowerCase()];
  if (!mapped) {
    throw new UnknownNetworkError(value);
  }
  return mapped;
}

function assertHttpUrl(url: string): void {
  if (!/^https?:\/\/.+/i.test(url)) {
    throw new InvalidRpcUrlError(url);
  }
}

/**
 * Map `--network` (and optional RPC overrides) to an RPC URL and passphrase.
 *
 * Precedence: explicit `rpcUrl` / `networkPassphrase` override the preset
 * selected by `network` (default: testnet).
 */
export function resolveNetworkConfig(
  overrides: NetworkOverrides = {}
): ResolvedNetworkConfig {
  const name = parseNetworkName(overrides.network ?? "testnet");
  const preset = NETWORK_PRESETS[name];

  const rpcUrl = overrides.rpcUrl?.trim() || preset.rpcUrl;
  const networkPassphrase =
    overrides.networkPassphrase?.trim() || preset.networkPassphrase;

  assertHttpUrl(rpcUrl);

  return { name, rpcUrl, networkPassphrase };
}

export interface AddNetworkOptionsConfig {
  /** When true, `--network` defaults to testnet (use on the root program). */
  withDefault?: boolean;
}

/**
 * Attach `--network`, `--rpc-url`, and `--network-passphrase` to a command.
 */
export function addNetworkOptions(
  command: Command,
  config: AddNetworkOptionsConfig = {}
): Command {
  const networkOption = new Option(
    "-n, --network <name>",
    "Target network (testnet, mainnet, or local)"
  ).choices([...NETWORK_CHOICES]);

  if (config.withDefault) {
    networkOption.default("testnet");
  }

  command.addOption(networkOption);
  command.option(
    "--rpc-url <url>",
    "Override Soroban RPC endpoint URL for the selected network"
  );
  command.option(
    "--network-passphrase <phrase>",
    "Override Stellar network passphrase for the selected network"
  );
  return command;
}

/**
 * The command about to run, then each ancestor. Closest flags win, so a
 * nested subcommand still sees `bc-forge --network`.
 */
function commandChain(command: Command): Command[] {
  const chain: Command[] = [];
  let current: Command | null | undefined = command;
  while (current) {
    chain.push(current);
    current = current.parent;
  }
  return chain;
}

function hasOption(command: Command, key: string): boolean {
  return command.options.some((option) => option.attributeName() === key);
}

function optionSource(command: Command, key: string): string | undefined {
  if (!hasOption(command, key)) return undefined;
  try {
    return command.getOptionValueSource(key);
  } catch {
    return undefined;
  }
}

function optionString(
  command: Command,
  key: "network" | "rpcUrl" | "networkPassphrase"
): string | undefined {
  if (!hasOption(command, key)) return undefined;
  const value = command.opts()[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Merge a subcommand's flags with ancestor (global) flags, preferring the
 * closest value. Child options have no default so an omitted `--network` on
 * the subcommand does not clobber `bc-forge --network`.
 */
export function mergeNetworkOptions(
  actionCommand: Command
): NetworkOverrides {
  const pick = (key: "network" | "rpcUrl" | "networkPassphrase") => {
    for (const command of commandChain(actionCommand)) {
      const value = optionString(command, key);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  return {
    network: pick("network"),
    rpcUrl: pick("rpcUrl"),
    networkPassphrase: pick("networkPassphrase"),
  };
}

/**
 * Flags the user actually passed on the CLI (`source === "cli"`), not defaults
 * filled in by commander or {@link attachNetworkResolution}.
 */
export function explicitNetworkOverrides(command: Command): NetworkOverrides {
  const pick = (key: "network" | "rpcUrl" | "networkPassphrase") => {
    for (const current of commandChain(command)) {
      if (optionSource(current, key) === "cli") {
        return current.opts()[key] as string | undefined;
      }
    }
    return undefined;
  };

  return {
    network: pick("network"),
    rpcUrl: pick("rpcUrl"),
    networkPassphrase: pick("networkPassphrase"),
  };
}

/**
 * Resolve network presets onto the command that is about to run so every
 * subcommand action sees `rpcUrl` and `networkPassphrase`.
 */
export function attachNetworkResolution(program: Command): void {
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const resolved = resolveNetworkConfig(mergeNetworkOptions(actionCommand));
    const assign = (key: "network" | "rpcUrl" | "networkPassphrase", value: string) => {
      if (!hasOption(actionCommand, key)) return;
      if (optionSource(actionCommand, key) === "cli") return;
      actionCommand.setOptionValueWithSource(key, value, "default");
    };

    assign("network", resolved.name);
    assign("rpcUrl", resolved.rpcUrl);
    assign("networkPassphrase", resolved.networkPassphrase);
  });
}
