import "@testing-library/jest-dom";
// SPDX-License-Identifier: MIT
import { act, renderHook, waitFor } from "@testing-library/react";
import type { bcForgeClient } from "@bc-forge/sdk";

const mockClient = {
  getName: jest.fn(),
  getSymbol: jest.fn(),
  getDecimals: jest.fn(),
  getContractId: jest.fn(),
  getAllowance: jest.fn(),
  approveProposal: jest.fn(),
  mint: jest.fn(),
  clearCache: jest.fn(),
};
const mockVaultClient = {
  deposit: jest.fn(),
};
const mockUseWallet = jest.fn(() => ({ status: "connected" as string }));

jest.mock("./context", () => ({
  useBcForgeClient: () => mockClient,
  useOptionalBcForgeClient: () => mockClient,
  useVaultClient: () => mockVaultClient,
  useWallet: mockUseWallet,
}));

import {
  clearTokenMetadataCache,
  decodeTransactionError,
  useAllowance,
  useProposalVote,
  useTokenMetadata,
  useTransactionSubmission,
  useVaultDeposit,
  type TransactionSubmissionStatus,
} from "./hooks";

describe("React client hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearTokenMetadataCache();
    mockUseWallet.mockReturnValue({ status: "connected" });
    mockClient.getName.mockResolvedValue("BC Forge Token");
    mockClient.getSymbol.mockResolvedValue("BCF");
    mockClient.getDecimals.mockResolvedValue(7);
    mockClient.getContractId.mockReturnValue(
      "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
    );
  });

  describe("useTokenMetadata (#1184)", () => {
    it("fetches token name, symbol, decimals, and contractId from bcForgeClient", async () => {
      const { result } = renderHook(() => useTokenMetadata());

      expect(result.current.loading).toBe(true);

      await waitFor(() =>
        expect(result.current.data).toEqual({
          name: "BC Forge Token",
          symbol: "BCF",
          decimals: 7,
          contractId:
            "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
        }),
      );

      expect(result.current.loading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockClient.getName).toHaveBeenCalledTimes(1);
      expect(mockClient.getSymbol).toHaveBeenCalledTimes(1);
      expect(mockClient.getDecimals).toHaveBeenCalledTimes(1);
    });

    it("caches metadata in memory to avoid repeated RPC roundtrips on re-mount", async () => {
      const first = renderHook(() => useTokenMetadata());

      await waitFor(() =>
        expect(first.result.current.data?.symbol).toBe("BCF"),
      );
      expect(mockClient.getName).toHaveBeenCalledTimes(1);
      first.unmount();

      const second = renderHook(() => useTokenMetadata());
      expect(second.result.current.data).toEqual({
        name: "BC Forge Token",
        symbol: "BCF",
        decimals: 7,
        contractId: "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
      });
      expect(second.result.current.loading).toBe(false);
      expect(second.result.current.error).toBeNull();
      expect(mockClient.getName).toHaveBeenCalledTimes(1);
      expect(mockClient.getSymbol).toHaveBeenCalledTimes(1);
      expect(mockClient.getDecimals).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent in-flight RPC calls for the same contract", async () => {
      const hookA = renderHook(() => useTokenMetadata());
      const hookB = renderHook(() => useTokenMetadata());

      await waitFor(() =>
        expect(hookA.result.current.data?.symbol).toBe("BCF"),
      );
      await waitFor(() =>
        expect(hookB.result.current.data?.symbol).toBe("BCF"),
      );

      expect(mockClient.getName).toHaveBeenCalledTimes(1);
      expect(mockClient.getSymbol).toHaveBeenCalledTimes(1);
      expect(mockClient.getDecimals).toHaveBeenCalledTimes(1);
    });

    it("supports manual refetch to bypass cache and refresh metadata", async () => {
      const { result } = renderHook(() => useTokenMetadata());

      await waitFor(() =>
        expect(result.current.data?.name).toBe("BC Forge Token"),
      );
      expect(mockClient.getName).toHaveBeenCalledTimes(1);

      mockClient.getName.mockResolvedValueOnce("BC Forge Token V2");
      mockClient.getSymbol.mockResolvedValueOnce("BCFV2");

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.data).toEqual({
        name: "BC Forge Token V2",
        symbol: "BCFV2",
        decimals: 7,
        contractId: "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
      });
      expect(mockClient.getName).toHaveBeenCalledTimes(2);
    });

    it("captures RPC errors and decodes Soroban contract errors gracefully", async () => {
      mockClient.getName.mockRejectedValueOnce(
        new Error("HostError: Error(Contract, #2)"),
      );

      const { result } = renderHook(() => useTokenMetadata());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toMatch(
        /TOKEN_NOT_INITIALIZED|Error\(Contract, #2\)/,
      );
    });

    it("handles empty contractId overrides with a descriptive error", async () => {
      const { result } = renderHook(() =>
        useTokenMetadata({ contractId: "   " }),
      );

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.data).toBeNull();
      expect(result.current.error?.message).toBe(
        "Invalid contract ID: contractId cannot be empty.",
      );
      expect(mockClient.getName).not.toHaveBeenCalled();
    });

    it("suspends fetching when enabled is false or client is explicitly null", () => {
      const disabled = renderHook(() => useTokenMetadata({ enabled: false }));
      expect(disabled.result.current.loading).toBe(false);
      expect(disabled.result.current.data).toBeNull();

      const noClient = renderHook(() => useTokenMetadata({ client: null }));
      expect(noClient.result.current.loading).toBe(false);
      expect(noClient.result.current.data).toBeNull();
      expect(mockClient.getName).not.toHaveBeenCalled();
    });

    it("supports custom client instances with contractId property fallback", async () => {
      const customClient = {
        contractId: "CCUSTOMCONTRACTID1234567890",
        getName: jest.fn().mockResolvedValue("Custom Token"),
        getSymbol: jest.fn().mockResolvedValue("CST"),
        getDecimals: jest.fn().mockResolvedValue(6),
      } as unknown as bcForgeClient;

      const { result } = renderHook(() =>
        useTokenMetadata({ client: customClient }),
      );

      await waitFor(() =>
        expect(result.current.data).toEqual({
          name: "Custom Token",
          symbol: "CST",
          decimals: 6,
          contractId: "CCUSTOMCONTRACTID1234567890",
        }),
      );
    });

    it("polls metadata on the configured interval and cleans up on unmount", async () => {
      jest.useFakeTimers();
      try {
        const { result, unmount } = renderHook(() =>
          useTokenMetadata({ pollIntervalMs: 5000 }),
        );

        await waitFor(() => expect(result.current.data?.symbol).toBe("BCF"));
        expect(mockClient.getName).toHaveBeenCalledTimes(1);

        mockClient.getName.mockResolvedValue("Updated Token");
        await act(async () => {
          jest.advanceTimersByTime(5000);
        });

        await waitFor(() =>
          expect(result.current.data?.name).toBe("Updated Token"),
        );
        expect(mockClient.getName).toHaveBeenCalledTimes(2);

        unmount();
        await act(async () => {
          jest.advanceTimersByTime(10000);
        });
        expect(mockClient.getName).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it("loads allowance data for the owner and spender", async () => {
    mockClient.getAllowance.mockResolvedValue(125n);

    const { result } = renderHook(() => useAllowance("GOWNER", "GSPENDER"));

    await waitFor(() => expect(result.current.data).toBe(125n));
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockClient.getAllowance).toHaveBeenCalledWith("GOWNER", "GSPENDER");
  });

  it("deposits through the configured vault client without a secret key argument", async () => {
    mockVaultClient.deposit.mockResolvedValue({
      success: true,
      hash: "deposit-hash",
    });

    const { result } = renderHook(() => useVaultDeposit());
    await act(async () => {
      await result.current.deposit("GOWNER", 500n, 450n);
    });

    expect(mockVaultClient.deposit).toHaveBeenCalledWith(
      "GOWNER",
      500n,
      undefined,
      450n,
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refuses a vault deposit unless the shared wallet state is connected", async () => {
    mockUseWallet.mockReturnValue({ status: "disconnected" });
    const { result } = renderHook(() => useVaultDeposit());

    await act(async () => {
      await expect(result.current.deposit("GOWNER", 500n)).rejects.toThrow(
        'Cannot submit a transaction while wallet status is "disconnected".',
      );
    });

    expect(mockVaultClient.deposit).not.toHaveBeenCalled();
  });

  it("votes for a proposal through the configured token client", async () => {
    mockClient.approveProposal.mockResolvedValue({
      success: true,
      hash: "vote-hash",
    });

    const { result } = renderHook(() => useProposalVote());
    await act(async () => {
      await result.current.vote("GADMIN", 9n);
    });

    expect(mockClient.approveProposal).toHaveBeenCalledWith("GADMIN", 9n);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refuses a proposal vote unless the shared wallet state is connected", async () => {
    mockUseWallet.mockReturnValue({ status: "disconnected" });
    const { result } = renderHook(() => useProposalVote());

    await act(async () => {
      await expect(result.current.vote("GADMIN", 9n)).rejects.toThrow(
        'Cannot submit a transaction while wallet status is "disconnected".',
      );
    });

    expect(mockClient.approveProposal).not.toHaveBeenCalled();
  });

  describe("useTransactionSubmission (#1193)", () => {
    it("starts in idle status with clean initial state", () => {
      const { result } = renderHook(() => useTransactionSubmission());

      expect(result.current.status).toBe("idle");
      expect(result.current.isIdle).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.loading).toBe(false);
      expect(result.current.txHash).toBeNull();
      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.alertMessage).toBeNull();
      expect(result.current.retryCount).toBe(0);
    });

    it("tracks full status transitions: idle -> simulating -> signing -> submitting -> confirmed", async () => {
      const transitions: TransactionSubmissionStatus[] = [];
      let resolveSimulate!: (val: string) => void;
      let resolveSign!: (val: string) => void;
      let resolveSend!: (val: { success: boolean; hash: string; returnValue?: unknown }) => void;

      const { result } = renderHook(() =>
        useTransactionSubmission({
          onStatusChange: (s) => transitions.push(s),
        }),
      );

      expect(result.current.status).toBe("idle");

      let submitPromise!: Promise<unknown>;
      act(() => {
        submitPromise = result.current.submit({
          method: "mint",
          simulate: () =>
            new Promise<string>((resolve) => {
              resolveSimulate = resolve;
            }),
          sign: () =>
            new Promise<string>((resolve) => {
              resolveSign = resolve;
            }),
          send: () =>
            new Promise((resolve) => {
              resolveSend = resolve;
            }),
        });
      });

      expect(result.current.status).toBe("simulating");
      expect(result.current.isSimulating).toBe(true);
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSimulate("UNSIGNED_XDR");
      });

      expect(result.current.status).toBe("signing");
      expect(result.current.isSigning).toBe(true);
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSign("SIGNED_XDR");
      });

      expect(result.current.status).toBe("submitting");
      expect(result.current.isSubmitting).toBe(true);
      expect(result.current.isLoading).toBe(true);

      await act(async () => {
        resolveSend({
          success: true,
          hash: "tx-hash-123",
          returnValue: 1000n,
        });
        await submitPromise;
      });

      expect(result.current.status).toBe("confirmed");
      expect(result.current.isConfirmed).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.txHash).toBe("tx-hash-123");
      expect(result.current.hash).toBe("tx-hash-123");
      expect(result.current.data).toEqual({
        success: true,
        hash: "tx-hash-123",
        returnValue: 1000n,
      });
      expect(result.current.error).toBeNull();
      expect(transitions).toEqual([
        "simulating",
        "signing",
        "submitting",
        "confirmed",
      ]);
      expect(mockClient.clearCache).toHaveBeenCalled();
    });

    it("tracks status transitions with callback-based action and lifecycle markers", async () => {
      const transitions: TransactionSubmissionStatus[] = [];
      const onSuccess = jest.fn();

      const { result } = renderHook(() =>
        useTransactionSubmission({
          onStatusChange: (s) => transitions.push(s),
          onSuccess,
        }),
      );

      await act(async () => {
        await result.current.submit(async ({ markSimulating, markSigning, markSubmitting }) => {
          markSimulating();
          markSigning();
          markSubmitting("callback-tx-hash");
          return {
            success: true,
            hash: "callback-tx-hash",
          };
        });
      });

      expect(result.current.status).toBe("confirmed");
      expect(result.current.txHash).toBe("callback-tx-hash");
      expect(transitions).toEqual([
        "simulating",
        "signing",
        "submitting",
        "confirmed",
      ]);
      expect(onSuccess).toHaveBeenCalledWith({
        success: true,
        hash: "callback-tx-hash",
      });
    });

    it("polls for ledger inclusion when send returns a hash and pollStatus is provided", async () => {
      jest.useFakeTimers();
      try {
        const pollStatus = jest
          .fn()
          .mockResolvedValueOnce({ status: "NOT_FOUND" as const })
          .mockResolvedValueOnce({ status: "PENDING" as const })
          .mockResolvedValueOnce({
            status: "SUCCESS" as const,
            returnValue: 42n,
          });

        const { result } = renderHook(() =>
          useTransactionSubmission({ pollIntervalMs: 200 }),
        );

        let submitPromise!: Promise<unknown>;
        act(() => {
          submitPromise = result.current.submit({
            simulate: async () => "UNSIGNED",
            sign: async () => "SIGNED",
            send: async () => "polled-tx-hash",
            pollStatus,
          });
        });

        await waitFor(() => expect(pollStatus).toHaveBeenCalledTimes(1));
        expect(result.current.status).toBe("submitting");
        expect(result.current.txHash).toBe("polled-tx-hash");

        await act(async () => {
          jest.advanceTimersByTime(200);
        });
        await waitFor(() => expect(pollStatus).toHaveBeenCalledTimes(2));

        await act(async () => {
          jest.advanceTimersByTime(200);
          await submitPromise;
        });

        expect(pollStatus).toHaveBeenCalledTimes(3);
        expect(result.current.status).toBe("confirmed");
        expect(result.current.data).toEqual({
          success: true,
          hash: "polled-tx-hash",
          returnValue: 42n,
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it("transitions to failed and sets helpful error when wallet is disconnected without unhandled rejection", async () => {
      mockUseWallet.mockReturnValue({ status: "disconnected" });
      const onError = jest.fn();

      const { result } = renderHook(() =>
        useTransactionSubmission({ onError }),
      );

      let submitRes: unknown;
      await act(async () => {
        submitRes = await result.current.submit(async () => ({
          success: true,
          hash: "never-reached",
        }));
      });

      expect(submitRes).toBeNull();
      expect(result.current.status).toBe("failed");
      expect(result.current.isFailed).toBe(true);
      expect(result.current.error?.message).toBe(
        'Cannot submit a transaction while wallet status is "disconnected".',
      );
      expect(result.current.alertMessage).toBe(
        'Cannot submit a transaction while wallet status is "disconnected".',
      );
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it("decodes Soroban token and admin contract error codes on failure", async () => {
      const { result } = renderHook(() => useTransactionSubmission());

      await act(async () => {
        await result.current.submit({
          method: "transfer",
          send: async () => {
            throw new Error("HostError: Error(Contract, #4)");
          },
        });
      });

      expect(result.current.status).toBe("failed");
      expect(result.current.error?.message).toMatch(
        /\[TOKEN_INSUFFICIENT_BALANCE\].*insufficient/i,
      );

      await act(async () => {
        await result.current.submit({
          method: "grant_role",
          send: async () => {
            throw new Error("HostError: Error(Contract, #3)");
          },
        });
      });

      expect(result.current.status).toBe("failed");
      expect(result.current.error?.message).toMatch(
        /\[ADMIN_UNAUTHORIZED_ROLE\].*not authorized/i,
      );
    });

    it("decodes wallet signature rejection into a friendly user message without retrying", async () => {
      const sendSpy = jest.fn();
      const { result } = renderHook(() =>
        useTransactionSubmission({ maxRetries: 3 }),
      );

      await act(async () => {
        await result.current.submit({
          simulate: async () => "UNSIGNED",
          sign: async () => {
            throw new Error("Freighter: User declined signature request");
          },
          send: sendSpy,
        });
      });

      expect(result.current.status).toBe("failed");
      expect(result.current.error?.message).toMatch(
        /Transaction cancelled by user/i,
      );
      expect(result.current.retryCount).toBe(0);
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it("automatically retries transient RPC failures and succeeds", async () => {
      let attempts = 0;
      const { result } = renderHook(() =>
        useTransactionSubmission({ maxRetries: 2, retryDelayMs: 10 }),
      );

      await act(async () => {
        await result.current.submit(async () => {
          attempts += 1;
          if (attempts < 2) {
            throw new Error("RPC timeout: network latency");
          }
          return { success: true, hash: "recovered-hash" };
        });
      });

      expect(attempts).toBe(2);
      expect(result.current.retryCount).toBe(1);
      expect(result.current.status).toBe("confirmed");
      expect(result.current.txHash).toBe("recovered-hash");
    });

    it("supports manual retry() and reset()", async () => {
      let shouldFail = true;
      const { result } = renderHook(() =>
        useTransactionSubmission({ maxRetries: 0 }),
      );

      await act(async () => {
        await result.current.submit(async () => {
          if (shouldFail) {
            throw new Error("Temporary RPC outage");
          }
          return { success: true, hash: "manual-retry-hash" };
        });
      });

      expect(result.current.status).toBe("failed");
      expect(result.current.error?.message).toBe("Temporary RPC outage");

      shouldFail = false;
      await act(async () => {
        await result.current.retry();
      });

      expect(result.current.status).toBe("confirmed");
      expect(result.current.txHash).toBe("manual-retry-hash");
      expect(result.current.error).toBeNull();

      act(() => {
        result.current.reset();
      });

      expect(result.current.status).toBe("idle");
      expect(result.current.txHash).toBeNull();
      expect(result.current.data).toBeNull();
    });

    it("supports manual refetch() for an existing transaction hash", async () => {
      const pollStatus = jest.fn().mockResolvedValue({
        status: "SUCCESS" as const,
        returnValue: "refetched-val",
      });

      const { result } = renderHook(() => useTransactionSubmission());

      await act(async () => {
        await result.current.submit({
          send: async () => ({ hash: "refetch-hash", success: true }),
          pollStatus,
        });
      });

      expect(result.current.status).toBe("confirmed");

      await act(async () => {
        await result.current.refetch();
      });

      expect(pollStatus).toHaveBeenCalledWith("refetch-hash");
      expect(result.current.status).toBe("confirmed");
      expect(result.current.data?.returnValue).toBe("refetched-val");
    });

    it("cleans up active timers and avoids state updates after unmount", async () => {
      jest.useFakeTimers();
      try {
        const pollStatus = jest.fn().mockResolvedValue({
          status: "PENDING" as const,
        });

        const { result, unmount } = renderHook(() =>
          useTransactionSubmission({ pollIntervalMs: 500 }),
        );

        act(() => {
          void result.current.submit({
            send: async () => "unmount-hash",
            pollStatus,
          });
        });

        await waitFor(() => expect(pollStatus).toHaveBeenCalledTimes(1));

        unmount();

        await act(async () => {
          jest.advanceTimersByTime(5000);
        });

        expect(pollStatus).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("exposes decodeTransactionError helper for standalone error normalization", () => {
      const tokenErr = decodeTransactionError(
        new Error("Error(Contract, #6)"),
        "transfer",
      );
      expect(tokenErr.message).toContain("[TOKEN_CONTRACT_PAUSED]");

      const adminErr = decodeTransactionError(
        new Error("Error(Contract, #11)"),
        "execute_proposal",
      );
      expect(adminErr.message).toContain("[ADMIN_THRESHOLD_NOT_MET]");
    });
  });
});
