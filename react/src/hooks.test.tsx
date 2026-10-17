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
  useAllowance,
  useProposalVote,
  useTokenMetadata,
  useVaultDeposit,
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
});
