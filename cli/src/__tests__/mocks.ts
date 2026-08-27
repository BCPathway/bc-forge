import { vi } from "vitest";

// ─── Fixtures ──────────────────────────────────────────────────────────────────

export const MOCK_CONTRACT_ID =
  "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAN2KM";
export const MOCK_NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const MOCK_RPC_URL = "https://soroban-testnet.stellar.org";
export const MOCK_SOURCE_SECRET =
  "SCDCLMWJXVQYZN6DQHT5GWBHJWJTDSYHQJQJTIT54T5PX5K4T7BD57AP";
export const MOCK_WASM_HASH =
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2";
export const MOCK_PUBLIC_KEY =
  "GBZCSTYJGKFBXQ7YXKCZC25S5XEHFPQSA2IWWYOI4RYC7YHXXSKZCQ3L";

export const TEST_KEYS = {
  admin: MOCK_PUBLIC_KEY,
  recipient: "GDQYHAWYCN4RCNXYZABCD2ABCD2ABCD2ABCD2ABCD2ABCD2ABCD2ABCD",
  minter: "GCKF7TQH5WZFRLJ5GZYJHKJQ5XYQ222DQI6HJT5Q3FPYL4DKDBRQXVKU",
};

export const MOCK_BALANCE = BigInt(1000_0000000);

// ─── Mock Account ───────────────────────────────────────────────────────────────

export function createMockAccount(publicKey = TEST_KEYS.admin) {
  return {
    accountId: () => publicKey,
    sequenceNumber: () => "12345",
    incrementSequenceNumber: vi.fn(),
  };
}

// ─── Mock Server Factory ────────────────────────────────────────────────────────

export interface MockServerOptions {
  balances?: Record<string, bigint>;
  failMethods?: string[];
  latency?: number;
  simulationError?: string;
}

export function createMockServer(options: MockServerOptions = {}) {
  return {
    getAccount: vi.fn(async (publicKey: string) => createMockAccount(publicKey)),
    sendTransaction: vi.fn(async () => {
      if (options.latency) await new Promise((r) => setTimeout(r, options.latency));
      return { status: "PENDING", hash: `mock_hash_${Date.now()}` };
    }),
    getTransaction: vi.fn(async (txHash: string) => {
      if (options.latency) await new Promise((r) => setTimeout(r, options.latency));
      return { status: "SUCCESS", hash: txHash, resultXdr: "AAAAAAA=" };
    }),
    simulateTransaction: vi.fn(async () => {
      if (options.latency) await new Promise((r) => setTimeout(r, options.latency));
      if (options.simulationError) {
        return { error: options.simulationError, events: [], id: "0", latestLedger: 1, _parsed: true };
      }
      return {
        status: "SIMULATION_SUCCESS",
        result: { retval: undefined },
        minResourceFee: "200000",
        transactionData: {},
        events: [],
        id: "0",
        latestLedger: 1,
        _parsed: true,
      };
    }),
  } as any;
}
