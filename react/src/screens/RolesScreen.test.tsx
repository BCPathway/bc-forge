// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { Role } from "@bc-forge/sdk";
import { BcForgeProvider, WalletProvider } from "../context";
import { useWallet } from "../hooks";
import { RolesScreen } from "./RolesScreen";
import { exportRbacReport } from "../utils";

const TARGET = "GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ4A";
const CALLER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";
const SECOND_SUPER_ADMIN =
  "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

const mockHasRole = jest.fn();
const mockGrantMinter = jest.fn();
const mockRevokeMinter = jest.fn();
const mockGrantSuperAdmin = jest.fn();
const mockRevokeSuperAdmin = jest.fn();
const mockGetEvents = jest.fn().mockResolvedValue([]);
const mockGetAdminPool = jest.fn();
const mockGetAdmin = jest.fn();
const mockListLegacyProposals = jest.fn();
const mockGetRoleProposal = jest.fn();
const mockCreateRoleProposal = jest.fn();
const mockExecuteRoleProposal = jest.fn();
const mockApproveProposal = jest.fn();
const mockIsPaused = jest.fn();
const mockPause = jest.fn();
const mockUnpause = jest.fn();

jest.mock("@bc-forge/sdk", () => ({
  Role: {
    Admin: "Admin",
    SuperAdmin: "SuperAdmin",
    Minter: "Minter",
    Pauser: "Pauser",
  },
  bcForgeClient: jest.fn().mockImplementation(function (
    this: { rpcUrl?: string; contractId?: string },
    config?: { rpcUrl?: string; contractId?: string },
  ) {
    this.rpcUrl = config?.rpcUrl;
    this.contractId = config?.contractId;
    return {
      rpcUrl: config?.rpcUrl,
      contractId: config?.contractId,
      hasRole: (...args: unknown[]) => mockHasRole(...args),
      grantMinter: (...args: unknown[]) => mockGrantMinter(...args),
      revokeMinter: (...args: unknown[]) => mockRevokeMinter(...args),
      grantSuperAdmin: (...args: unknown[]) => mockGrantSuperAdmin(...args),
      revokeSuperAdmin: (...args: unknown[]) => mockRevokeSuperAdmin(...args),
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
      getAdminPool: (...args: unknown[]) => mockGetAdminPool(...args),
      getAdmin: (...args: unknown[]) => mockGetAdmin(...args),
      listLegacyProposals: (...args: unknown[]) =>
        mockListLegacyProposals(...args),
      getRoleProposal: (...args: unknown[]) => mockGetRoleProposal(...args),
      createRoleProposal: (...args: unknown[]) =>
        mockCreateRoleProposal(...args),
      executeRoleProposal: (...args: unknown[]) =>
        mockExecuteRoleProposal(...args),
      approveProposal: (...args: unknown[]) => mockApproveProposal(...args),
      isPaused: (...args: unknown[]) => mockIsPaused(...args),
      pause: (...args: unknown[]) => mockPause(...args),
      unpause: (...args: unknown[]) => mockUnpause(...args),
      setWalletAdapter: jest.fn(),
      getContractId: () => config?.contractId ?? "",
    };
  }),
  FreighterAdapter: class {
    name = "freighter";
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey =
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  },
  AlbedoAdapter: class {
    name = "albedo";
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey =
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  },
}));

jest.mock("../hooks", () => {
  const actual = jest.requireActual("../hooks");
  return {
    ...actual,
    useProposalVote: () => ({
      vote: (admin: string, id: bigint) => mockApproveProposal(admin, id),
    }),
  };
});

const config = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
};

const AutoConnect: React.FC<{ connectOnMount: boolean }> = ({
  connectOnMount,
}) => {
  const { connect, status } = useWallet();
  React.useEffect(() => {
    if (connectOnMount && status === "disconnected") {
      void connect("freighter");
    }
  }, [connectOnMount, connect, status]);
  return null;
};

const renderWithWallet = (connectOnMount: boolean) =>
  render(
    <BcForgeProvider config={config}>
      <WalletProvider autoRestore={false}>
        <AutoConnect connectOnMount={connectOnMount} />
        <RolesScreen debounceMs={0} />
      </WalletProvider>
    </BcForgeProvider>,
  );

describe("RolesScreen (#906, #1224, #1225, #1227, #1228, #1231, #1232, #1233)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasRole.mockImplementation(async (role: Role, address: string) => {
      if (address === TARGET) return role === Role.Minter;
      if (address === CALLER)
        return role === Role.Admin || role === Role.SuperAdmin;
      return false;
    });
    mockGrantMinter.mockResolvedValue({ success: true, hash: "GRANTHASH1" });
    mockRevokeMinter.mockResolvedValue({ success: true, hash: "REVOKEHASH1" });
    mockGrantSuperAdmin.mockResolvedValue({
      success: true,
      hash: "SAGRANTHASH1",
    });
    mockRevokeSuperAdmin.mockResolvedValue({
      success: true,
      hash: "SAREVOKE1",
    });
    mockGetEvents.mockResolvedValue([]);
    mockGetAdminPool.mockResolvedValue([]);
    mockGetAdmin.mockResolvedValue(null);
    mockListLegacyProposals.mockResolvedValue({
      pendingIds: [],
      approvedIds: [],
      nextCursor: null,
    });
    mockGetRoleProposal.mockResolvedValue(null);
    mockCreateRoleProposal.mockResolvedValue({
      success: true,
      hash: "PROPHASH1",
      returnValue: 9n,
    });
    mockExecuteRoleProposal.mockResolvedValue({
      success: true,
      hash: "EXECPROPHASH1",
    });
    mockApproveProposal.mockResolvedValue({
      success: true,
      hash: "APPROVEHASH1",
    });
    mockIsPaused.mockResolvedValue(false);
    mockPause.mockResolvedValue({ success: true, hash: "PAUSEHASH1" });
    mockUnpause.mockResolvedValue({ success: true, hash: "UNPAUSEHASH1" });
  });

  const typeTarget = (value: string) =>
    fireEvent.change(screen.getByPlaceholderText(/target/i), {
      target: { value },
    });

  const connectedWithTarget = async () => {
    renderWithWallet(true);
    await waitFor(() =>
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      ),
    );
    typeTarget(TARGET);
    await waitFor(() =>
      expect(screen.getByTestId("role-badge-Minter")).toHaveTextContent(
        "Minter: Granted",
      ),
    );
    await waitFor(() => expect(screen.getByTestId("open-grant")).toBeEnabled());
  };

  it("renders a card per role and badges from hasRole", async () => {
    renderWithWallet(false);
    expect(screen.getAllByTestId(/^role-card-/)).toHaveLength(4);
    typeTarget(TARGET);
    await waitFor(() =>
      expect(screen.getByTestId("role-badge-Minter")).toHaveTextContent(
        "Minter: Granted",
      ),
    );
    expect(screen.getByTestId("role-badge-Admin")).toHaveTextContent(
      "Admin: Not granted",
    );
    expect(screen.getByTestId("role-count")).toHaveTextContent(
      "Roles held: 1 of 4",
    );
    [Role.Admin, Role.SuperAdmin, Role.Minter, Role.Pauser].forEach((r) =>
      expect(mockHasRole).toHaveBeenCalledWith(r, TARGET),
    );
  });

  it("shows a validation error and clears the matrix for an invalid address", async () => {
    renderWithWallet(false);
    typeTarget(TARGET);
    await waitFor(() =>
      expect(screen.getByTestId("role-badge-Minter")).toHaveTextContent(
        "Granted",
      ),
    );
    typeTarget("not-an-address");
    expect(screen.getByTestId("target-error")).toBeInTheDocument();
    expect(screen.queryByTestId("role-count")).not.toBeInTheDocument();
    expect(screen.getByTestId("role-badge-Minter")).toHaveTextContent(
      "Minter: —",
    );
  });

  it("alerts when the lookup fails", async () => {
    mockHasRole.mockRejectedValue(new Error("rpc timeout"));
    renderWithWallet(false);
    typeTarget(TARGET);
    expect(await screen.findByRole("alert")).toHaveTextContent("rpc timeout");
  });

  it("disables actions when the wallet is disconnected", async () => {
    renderWithWallet(false);
    typeTarget(TARGET);
    await waitFor(() =>
      expect(screen.getByTestId("role-badge-Minter")).toHaveTextContent(
        "Granted",
      ),
    );
    expect(screen.getByTestId("open-grant")).toBeDisabled();
    expect(screen.getByTestId("revoke-minter")).toBeDisabled();
  });

  it("disables actions when the caller is not an admin", async () => {
    mockHasRole.mockResolvedValue(false);
    renderWithWallet(true);
    typeTarget(TARGET);
    await waitFor(() => {
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      );
    });
    expect(screen.getByTestId("open-grant")).toBeDisabled();
  });

  it("grants Minter through the modal and shows success", async () => {
    await connectedWithTarget();
    fireEvent.click(screen.getByTestId("open-grant"));
    expect(screen.getByTestId("grant-role-modal")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    await waitFor(() => expect(mockGrantMinter).toHaveBeenCalledWith(TARGET));
    expect(await screen.findByRole("status")).toHaveTextContent("GRANTHASH1");
  });

  it("grants SuperAdmin when selected in the dropdown", async () => {
    await connectedWithTarget();
    fireEvent.click(screen.getByTestId("open-grant"));
    fireEvent.click(
      within(screen.getByTestId("grant-role-modal")).getByRole("button", {
        expanded: false,
      }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Super Admin" }),
    );
    const confirm = screen.getByRole("button", { name: "Grant SuperAdmin" });
    expect(confirm).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mockGrantSuperAdmin).toHaveBeenCalledWith(TARGET),
    );
  });

  it("shows an error inside the grant modal when the grant is rejected", async () => {
    mockGrantMinter.mockRejectedValue(new Error("user rejected"));
    await connectedWithTarget();
    fireEvent.click(screen.getByTestId("open-grant"));
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    expect(await screen.findByText("user rejected")).toBeInTheDocument();
    expect(screen.getByTestId("grant-role-modal")).toBeInTheDocument();
  });

  it("requires confirmation before revoking Minter", async () => {
    await connectedWithTarget();
    fireEvent.click(screen.getByTestId("revoke-minter"));
    const confirm = screen.getByRole("button", { name: "Revoke" });
    expect(confirm).toBeDisabled();
    expect(mockRevokeMinter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    await waitFor(() => expect(mockRevokeMinter).toHaveBeenCalledWith(TARGET));
    expect(await screen.findByRole("status")).toHaveTextContent("REVOKEHASH1");
  });

  it("shows an alert when the revoke transaction fails", async () => {
    mockRevokeMinter.mockResolvedValue({ success: false, hash: "FAILHASH" });
    await connectedWithTarget();
    fireEvent.click(screen.getByTestId("revoke-minter"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText(/FAILHASH/)).toBeInTheDocument();
  });

  it("explains each role permission in a badge tooltip and distinguishes granted from not granted", async () => {
    renderWithWallet(false);
    typeTarget(TARGET);

    await waitFor(() => {
      expect(screen.getByTestId("role-badge-Minter")).toHaveTextContent(
        "Minter: Granted",
      );
    });

    expect(screen.getByTestId("role-badge-Minter")).toHaveAttribute(
      "title",
      expect.stringMatching(/mint/i),
    );
    expect(screen.getByTestId("role-badge-Pauser")).toHaveAttribute(
      "title",
      expect.stringMatching(/pause/i),
    );
    expect(screen.getByTestId("role-badge-Admin")).toHaveAttribute(
      "title",
      expect.any(String),
    );
    expect(screen.getByTestId("role-badge-SuperAdmin")).toHaveAttribute(
      "title",
      expect.stringMatching(/super/i),
    );
    expect(screen.getByTestId("role-badge-Minter")).toHaveAttribute(
      "data-status",
      "granted",
    );
    expect(screen.getByTestId("role-badge-Admin")).toHaveAttribute(
      "data-status",
      "not-granted",
    );
  });

  it("exports role assignments in the selected format", async () => {
    await connectedWithTarget();
    const createObjectURL = jest.fn(() => "blob:mock");
    const revokeObjectURL = jest.fn();
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    fireEvent.change(screen.getByLabelText("Export format"), {
      target: { value: "json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Export permissions" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalled());

    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });

  it("blocks revoking the last active SuperAdmin", async () => {
    mockGetAdminPool.mockResolvedValue([TARGET]);
    mockGetAdmin.mockResolvedValue(TARGET);
    mockHasRole.mockImplementation(
      async (role: Role, address: string) =>
        (role === Role.SuperAdmin && address === TARGET) ||
        (role === Role.Admin && address === CALLER) ||
        (role === Role.SuperAdmin && address === CALLER),
    );
    renderWithWallet(true);

    await waitFor(() => {
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      );
    });
    fireEvent.change(screen.getByPlaceholderText(/target/i), {
      target: { value: TARGET },
    });
    await waitFor(() => {
      expect(screen.getByTestId("revoke-super-admin")).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId("revoke-super-admin"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Cannot revoke last active Super Admin",
    );
    expect(mockRevokeSuperAdmin).not.toHaveBeenCalled();
  });

  it("allows revoking a SuperAdmin when another configured holder remains", async () => {
    mockGetAdminPool.mockResolvedValue([TARGET, SECOND_SUPER_ADMIN]);
    mockHasRole.mockImplementation(
      async (role: Role) => role === Role.SuperAdmin,
    );
    renderWithWallet(true);
    await waitFor(() => {
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      );
    });
    fireEvent.change(screen.getByPlaceholderText(/target/i), {
      target: { value: TARGET },
    });
    await waitFor(() => {
      expect(screen.getByTestId("revoke-super-admin")).toBeEnabled();
    });
    fireEvent.click(screen.getByTestId("revoke-super-admin"));

    await waitFor(() =>
      expect(mockRevokeSuperAdmin).toHaveBeenCalledWith(TARGET),
    );
  });

  it("creates a proposal for the selected role and target", async () => {
    renderWithWallet(true);
    await waitFor(() => {
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      );
    });
    fireEvent.change(screen.getByPlaceholderText(/target/i), {
      target: { value: TARGET },
    });
    fireEvent.change(screen.getByLabelText("Proposal role"), {
      target: { value: Role.SuperAdmin },
    });
    fireEvent.click(screen.getByTestId("create-role-proposal"));

    await waitFor(() =>
      expect(mockCreateRoleProposal).toHaveBeenCalledWith(
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT",
        Role.SuperAdmin,
        TARGET,
        `Grant SuperAdmin to ${TARGET}`,
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Proposal #9 created",
    );
  });

  it("loads pending proposals and routes approval through the SDK client", async () => {
    mockListLegacyProposals.mockResolvedValue({
      pendingIds: [4n],
      approvedIds: [],
      nextCursor: null,
    });
    mockGetRoleProposal.mockResolvedValue({
      role: Role.Minter,
      target: TARGET,
      description: `Grant Minter to ${TARGET}`,
      approvals: 1,
      quorum: 2,
      executed: false,
    });
    renderWithWallet(true);
    await waitFor(() => {
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(mockApproveProposal).toHaveBeenCalledWith(
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT",
        4n,
      ),
    );
    expect(screen.getByText("1 of 2 approvals")).toBeInTheDocument();
  });

  it("executes a ready role proposal and refreshes its state", async () => {
    mockListLegacyProposals.mockResolvedValue({
      pendingIds: [],
      approvedIds: [4n],
      nextCursor: null,
    });
    mockGetRoleProposal.mockResolvedValue({
      role: Role.Minter,
      target: TARGET,
      description: `Grant Minter to ${TARGET}`,
      approvals: 2,
      quorum: 2,
      executed: false,
    });
    renderWithWallet(true);
    await waitFor(() => {
      expect(screen.getByTestId("roles-connected-account")).toHaveTextContent(
        "GBRP…YOXT",
      );
    });

    fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    await waitFor(() =>
      expect(mockExecuteRoleProposal).toHaveBeenCalledWith(
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT",
        4n,
      ),
    );
  });

  it("loads proposal IDs across listing pages", async () => {
    mockListLegacyProposals
      .mockResolvedValueOnce({
        pendingIds: [4n],
        approvedIds: [],
        nextCursor: 50n,
      })
      .mockResolvedValueOnce({
        pendingIds: [51n],
        approvedIds: [],
        nextCursor: null,
      });
    mockGetRoleProposal.mockImplementation(async (id: bigint) => ({
      role: Role.Minter,
      target: TARGET,
      description: `Proposal ${id}`,
      approvals: 1,
      quorum: 2,
      executed: false,
    }));
    renderWithWallet(false);

    expect(await screen.findByTestId("proposal-4")).toBeInTheDocument();
    expect(screen.getByTestId("proposal-51")).toBeInTheDocument();
    expect(mockListLegacyProposals).toHaveBeenCalledTimes(2);
    expect(mockListLegacyProposals).toHaveBeenLastCalledWith(50n);
  });

  it("requires confirmation before a Pauser can pause the contract", async () => {
    const walletAddress =
      "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";
    mockHasRole.mockImplementation(
      async (role: Role, address: string) =>
        role === Role.Pauser && address === walletAddress,
    );
    mockIsPaused.mockResolvedValue(false);
    renderWithWallet(true);

    const pauseButton = await screen.findByTestId("toggle-contract-pause");
    expect(screen.getByTestId("contract-pause-status")).toHaveTextContent(
      "active",
    );
    fireEvent.click(pauseButton);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /^Pause$/ }));

    await waitFor(() => expect(mockPause).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("PAUSEHASH1");
  });
});

describe("exportRbacReport", () => {
  it("creates timestamped JSON and CSV reports with address and audit data", () => {
    const roles = { Admin: true, Minter: false };
    const events = [{ type: "role_granted", ledger: 42n }];
    const timestamp = "2026-10-19T12:30:00.000Z";

    const json = exportRbacReport(TARGET, roles, events, "json", timestamp);
    expect(json.filename).toBe("rbac-report-2026-10-19T12-30-00-000Z.json");
    expect(JSON.parse(json.content)).toEqual({
      exportedAt: timestamp,
      roleAssignments: [{ address: TARGET, roles }],
      auditHistory: [{ type: "role_granted", ledger: "42" }],
    });

    const csv = exportRbacReport(TARGET, roles, events, "csv", timestamp);
    expect(csv.content).toContain('"role","' + TARGET + '","Admin","true"');
    expect(csv.content).toContain(
      '"audit","","","","{""type"":""role_granted"",""ledger"":""42""}"',
    );
  });
});
