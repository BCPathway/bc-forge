// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock("@bc-forge/sdk", () => ({ Role: {}, parseContractError: jest.fn() }));

import { VestingScreen, percentOf } from "../VestingScreen";
import { SplitScreen } from "../SplitScreen";
import type { SplitClientLike, VestingClaimClientLike } from "../../hooks";

function sdkClient(info: unknown) {
  return {
    getLatestLedgerSequence: jest.fn().mockResolvedValue(200),
    getVestingInfo: jest.fn().mockResolvedValue(info),
  } as any;
}

const rawSchedule = [
  {
    schedule_id: 1,
    start_ledger: 100,
    schedule: {
      beneficiary: "G1",
      total_amount: 1000n,
      cliff_ledger: 150,
      end_ledger: 300,
      released_amount: 200n,
    },
  },
];

describe("VestingScreen", () => {
  it("renders progress, breakdown cards and claims", async () => {
    const claimClient: VestingClaimClientLike = {
      claim: jest.fn().mockResolvedValue({ success: true, hash: "abc" }),
    };
    render(
      <VestingScreen
        contractId="C1"
        beneficiaryAddress="G1"
        client={sdkClient(rawSchedule)}
        claimClient={claimClient}
        currentLedger={200}
      />,
    );
    const bar = await screen.findByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("Total Allocated")).toBeInTheDocument();
    expect(screen.getByText("1000")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("Currently Claimable")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Claim Vested Tokens" }),
    );
    await waitFor(() =>
      expect(claimClient.claim).toHaveBeenCalledWith("C1", "G1"),
    );
    expect(await screen.findByText(/Claim submitted: abc/)).toBeInTheDocument();
  });

  it("shows a claim error", async () => {
    const claimClient: VestingClaimClientLike = {
      claim: jest
        .fn()
        .mockResolvedValue({ success: false, error: "nothing to claim" }),
    };
    render(
      <VestingScreen
        contractId="C1"
        beneficiaryAddress="G1"
        client={sdkClient(rawSchedule)}
        claimClient={claimClient}
        currentLedger={200}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Claim Vested Tokens" }),
    );
    expect(await screen.findByText(/nothing to claim/)).toBeInTheDocument();
  });

  it("shows an empty state without a schedule", async () => {
    render(
      <VestingScreen
        contractId="C1"
        beneficiaryAddress="G1"
        client={sdkClient([])}
        claimClient={{ claim: jest.fn() }}
        currentLedger={200}
      />,
    );
    expect(
      await screen.findByText("No vesting schedule found."),
    ).toBeInTheDocument();
  });

  it("clamps percentages", () => {
    expect(percentOf(5, 0)).toBe(0);
    expect(percentOf(-1, 10)).toBe(0);
    expect(percentOf(20, 10)).toBe(100);
  });
});

describe("SplitScreen", () => {
  const rows = [
    { invoiceId: 1, recipient: "GA", amount: 10n, status: "Success" as const },
    { invoiceId: 1, recipient: "GB", amount: 20n, status: "Failed" as const },
  ];

  it("lists payouts and retries failed ones", async () => {
    const client: SplitClientLike = {
      getSplitHistory: jest.fn().mockResolvedValue(rows),
      retryFailed: jest.fn().mockResolvedValue({ success: true }),
    };
    render(<SplitScreen contractId="C2" client={client} />);
    expect(await screen.findByText("GA")).toBeInTheDocument();
    expect(screen.getByText("Success")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Retry Failed Payouts" }),
    );
    await waitFor(() =>
      expect(client.retryFailed).toHaveBeenCalledWith("C2", 1, "GB"),
    );
    expect(await screen.findByText(/Retried 1 of 1/)).toBeInTheDocument();
  });

  it("disables retry with no failures", async () => {
    const client: SplitClientLike = {
      getSplitHistory: jest.fn().mockResolvedValue([rows[0]]),
      retryFailed: jest.fn(),
    };
    render(<SplitScreen contractId="C2" client={client} />);
    await screen.findByText("GA");
    expect(
      screen.getByRole("button", { name: "Retry Failed Payouts" }),
    ).toBeDisabled();
  });

  it("surfaces load errors", async () => {
    const client: SplitClientLike = {
      getSplitHistory: jest.fn().mockRejectedValue(new Error("rpc down")),
      retryFailed: jest.fn(),
    };
    render(<SplitScreen contractId="C2" client={client} />);
    expect(await screen.findByText(/rpc down/)).toBeInTheDocument();
  });
});
