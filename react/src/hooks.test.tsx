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
  hasRole: jest.fn(),
  getRoleAdmin: jest.fn(),
  getAdmin: jest.fn(),
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

jest.mock("@bc-forge/sdk", () => ({
  Role: {
    Admin: "Admin",
    SuperAdmin: "SuperAdmin",
    Minter: "Minter",
    Pauser: "Pauser",
  },
  bcForgeClient: jest.fn(),
  VaultClient: jest.fn(),
}));

import {
  clearTokenMetadataCache,
  Role,
  useAllowance,
  useProposalVote,
  useRbacRoles,
  useRoleAdmins,
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

  describe("useRbacRoles (#1187)", () => {
    it("checks hasRole for Admin, SuperAdmin, Minter, and Pauser against target address", async () => {
      mockClient.hasRole.mockImplementation((role: string, _addr: string) => {
        if (role === Role.Admin || role === Role.SuperAdmin)
          return Promise.resolve(true);
        return Promise.resolve(false);
      });

      const { result } = renderHook(() => useRbacRoles("GACCOUNT123"));

      expect(result.current.loading).toBe(true);

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.roles).toEqual({
        [Role.Admin]: true,
        [Role.SuperAdmin]: true,
        [Role.Minter]: false,
        [Role.Pauser]: false,
      });
      expect(result.current.data).toEqual(result.current.roles);
      expect(result.current.error).toBeNull();
      expect(mockClient.hasRole).toHaveBeenCalledWith(
        Role.Admin,
        "GACCOUNT123",
      );
      expect(mockClient.hasRole).toHaveBeenCalledWith(
        Role.SuperAdmin,
        "GACCOUNT123",
      );
      expect(mockClient.hasRole).toHaveBeenCalledWith(
        Role.Minter,
        "GACCOUNT123",
      );
      expect(mockClient.hasRole).toHaveBeenCalledWith(
        Role.Pauser,
        "GACCOUNT123",
      );
    });

    it("returns default all-false roles without fetching when address is empty", async () => {
      const { result } = renderHook(() => useRbacRoles("   "));

      expect(result.current.loading).toBe(false);
      expect(result.current.roles).toEqual({
        [Role.Admin]: false,
        [Role.SuperAdmin]: false,
        [Role.Minter]: false,
        [Role.Pauser]: false,
      });
      expect(mockClient.hasRole).not.toHaveBeenCalled();
    });

    it("supports manual refetch of role mapping", async () => {
      mockClient.hasRole.mockResolvedValue(false);

      const { result } = renderHook(() => useRbacRoles("GACCOUNT123"));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.roles[Role.Minter]).toBe(false);

      mockClient.hasRole.mockImplementation((role: string) => {
        if (role === Role.Minter) return Promise.resolve(true);
        return Promise.resolve(false);
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.roles[Role.Minter]).toBe(true);
    });

    it("handles RPC errors gracefully", async () => {
      mockClient.hasRole.mockRejectedValueOnce(new Error("RPC Timeout"));

      const { result } = renderHook(() => useRbacRoles("GACCOUNT123"));
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("RPC Timeout");
    });
  });

  describe("useRoleAdmins (#1189)", () => {
    it("queries role admin authorities and super admin accounts for governance introspection", async () => {
      mockClient.getAdmin.mockResolvedValue("GADMIN123");
      mockClient.getRoleAdmin.mockImplementation((role: string) => {
        if (role === Role.Minter) return Promise.resolve("GMINTERADMIN");
        return Promise.resolve("GADMIN123");
      });
      mockClient.hasRole.mockResolvedValue(true);

      const { result } = renderHook(() =>
        useRoleAdmins({ candidateAddresses: ["GSUPER1"] }),
      );

      expect(result.current.loading).toBe(true);
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.data).toContain("GADMIN123");
      expect(result.current.data).toContain("GMINTERADMIN");
      expect(result.current.data).toContain("GSUPER1");
      expect(result.current.admins).toEqual(result.current.data);
      expect(result.current.roleAdmins[Role.Minter]).toBe("GMINTERADMIN");
      expect(result.current.superAdmins).toContain("GADMIN123");
      expect(result.current.superAdmins).toContain("GSUPER1");
      expect(result.current.error).toBeNull();
    });

    it("queries admin authority for a specific role", async () => {
      mockClient.getAdmin.mockResolvedValue("GADMIN123");
      mockClient.getRoleAdmin.mockResolvedValue("GPAUSERADMIN");

      const { result } = renderHook(() => useRoleAdmins(Role.Pauser));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.data).toContain("GPAUSERADMIN");
      expect(result.current.roleAdmins[Role.Pauser]).toBe("GPAUSERADMIN");
      expect(mockClient.getRoleAdmin).toHaveBeenCalledWith(Role.Pauser);
    });

    it("captures errors gracefully and provides refetch capability", async () => {
      mockClient.getAdmin.mockRejectedValue(
        new Error("RPC Network Failure"),
      );
      mockClient.getRoleAdmin.mockRejectedValue(
        new Error("RPC Network Failure"),
      );

      const { result } = renderHook(() => useRoleAdmins());
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe("RPC Network Failure");

      mockClient.getAdmin.mockResolvedValue("GADMIN_RECOVERED");
      mockClient.getRoleAdmin.mockResolvedValue("GADMIN_RECOVERED");

      await act(async () => {
        await result.current.refetch();
      });

      expect(result.current.data).toContain("GADMIN_RECOVERED");
      expect(result.current.error).toBeNull();
    });
  });
});
