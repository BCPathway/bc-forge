// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import {
  TransferScreen,
  validateTransferDestination,
  validateTransferAmount,
  describeTransferError,
  TRANSFER_SELF_ERROR,
  TRANSFER_INVALID_ADDRESS_ERROR,
  TRANSFER_INSUFFICIENT_BALANCE_ERROR,
} from "./TransferScreen";

const mockUseBalance = jest.fn();
const mockRefetch = jest.fn();
const mockTransfer = jest.fn();
const mockEstimate = jest.fn();
let mockFeeData: {
  feeStroops: bigint;
  feeXlm: string;
  recipientExists: boolean;
} | null = null;
const mockTransferState: { loading: boolean; error: Error | null } = {
  loading: false,
  error: null,
};

// The SDK entry point loads ESM-only @noble/* packages Jest cannot require, so
// expose only the real StrKey implementation, which has no such dependency.
jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: jest.requireActual<{ StrKey: unknown }>(
    "../../../node_modules/@stellar/stellar-sdk/lib/cjs/base/strkey.js",
  ).StrKey,
}));

jest.mock("../hooks", () => ({
  useBalance: (...args: unknown[]) => mockUseBalance(...args),
  useEstimateFee: () => ({
    estimate: mockEstimate,
    reset: jest.fn(),
    data: mockFeeData,
    loading: false,
    error: null as Error | null,
  }),
  useTransfer: () => ({
    transfer: mockTransfer,
    loading: mockTransferState.loading,
    error: mockTransferState.error,
  }),
}));

const ADDRESS = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const DESTINATION = "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U";

function fillForm(destination: string, amount: string) {
  fireEvent.change(screen.getByLabelText("Destination address"), {
    target: { value: destination },
  });
  fireEvent.change(screen.getByLabelText("Amount"), {
    target: { value: amount },
  });
}

describe("TransferScreen validation helpers", () => {
  it("validates destination addresses", () => {
    expect(validateTransferDestination("", ADDRESS)).toBeNull();
    expect(validateTransferDestination("not-a-key", ADDRESS)).toBe(
      TRANSFER_INVALID_ADDRESS_ERROR,
    );
    expect(
      validateTransferDestination(`${DESTINATION.slice(0, -1)}A`, ADDRESS),
    ).toBe(TRANSFER_INVALID_ADDRESS_ERROR);
    expect(validateTransferDestination(` ${ADDRESS} `, ADDRESS)).toBe(
      TRANSFER_SELF_ERROR,
    );
    expect(validateTransferDestination(DESTINATION, ADDRESS)).toBeNull();
    expect(validateTransferDestination(DESTINATION, undefined)).toBeNull();
  });

  it("validates amounts against the balance", () => {
    expect(validateTransferAmount("", 10n)).toBeNull();
    expect(validateTransferAmount("1.5", 10n)).not.toBeNull();
    expect(validateTransferAmount("0", 10n)).not.toBeNull();
    expect(validateTransferAmount("11", 10n)).toBe(
      TRANSFER_INSUFFICIENT_BALANCE_ERROR,
    );
    expect(validateTransferAmount("10", 10n)).toBeNull();
    expect(validateTransferAmount("11", null)).toBeNull();
  });

  it("describes common transfer failures", () => {
    expect(
      describeTransferError(new Error("User rejected the request")),
    ).toMatch(/rejected/);
    expect(describeTransferError(new Error("Request timed out"))).toMatch(
      /timed out/,
    );
    expect(describeTransferError(new Error("Network Error"))).toMatch(
      /network error/,
    );
    expect(describeTransferError(new Error("boom"))).toBe("boom");
  });
});

describe("TransferScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransferState.loading = false;
    mockTransferState.error = null;
    mockRefetch.mockResolvedValue(undefined);
    mockUseBalance.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      refetch: mockRefetch,
    });
    mockTransfer.mockResolvedValue({ success: true, hash: "0xtransferhash" });
  });

  it("disables submit while disconnected, when the destination is empty, and for invalid or over-balance amounts", () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
      refetch: mockRefetch,
    });

    const { rerender } = render(<TransferScreen />);
    expect(screen.getByTestId("transfer-connected-address")).toHaveTextContent(
      "Not connected",
    );
    expect(screen.getByTestId("transfer-disconnected")).toBeInTheDocument();
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();

    rerender(<TransferScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("transfer-balance")).toHaveTextContent("1000");
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();

    fillForm(DESTINATION, "0");
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "1001" },
    });
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();
    expect(screen.getByTestId("transfer-over-balance")).toHaveTextContent(
      "Insufficient balance",
    );
    expect(mockTransfer).not.toHaveBeenCalled();
  });

  it("shows destination validation messages and blocks submission", () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
      refetch: mockRefetch,
    });
    render(<TransferScreen walletAddress={ADDRESS} />);

    fillForm("GABC", "10");
    expect(screen.getByTestId("transfer-destination-error")).toHaveTextContent(
      "Invalid Stellar public key format",
    );
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();

    fillForm(ADDRESS, "10");
    expect(screen.getByTestId("transfer-destination-error")).toHaveTextContent(
      "Cannot transfer to self",
    );
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();

    fillForm(DESTINATION, "10");
    expect(
      screen.queryByTestId("transfer-destination-error"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("transfer-submit")).toBeEnabled();
  });

  it("submits once, clears the form, refetches the balance and opens the receipt", async () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
      refetch: mockRefetch,
    });
    let resolveTransfer: (value: {
      success: boolean;
      hash: string;
    }) => void = () => {};
    mockTransfer.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTransfer = resolve;
        }),
    );
    const onTransferConfirmed = jest.fn();

    render(
      <TransferScreen
        walletAddress={ADDRESS}
        onTransferConfirmed={onTransferConfirmed}
      />,
    );
    fillForm(DESTINATION, "250");

    const submit = screen.getByTestId("transfer-submit");
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest("form") as HTMLFormElement);

    await waitFor(() =>
      expect(screen.getByTestId("transfer-spinner")).toBeInTheDocument(),
    );
    expect(submit).toBeDisabled();
    expect(submit).toHaveTextContent("Transferring…");
    expect(mockTransfer).toHaveBeenCalledTimes(1);
    expect(mockTransfer).toHaveBeenCalledWith(ADDRESS, DESTINATION, 250n);

    await act(async () => {
      resolveTransfer({ success: true, hash: "0xtransferhash" });
    });

    const receipt = await screen.findByTestId("transfer-receipt");
    expect(receipt).toHaveAttribute("role", "dialog");
    expect(screen.getByTestId("transfer-receipt-from")).toHaveTextContent(
      ADDRESS,
    );
    expect(screen.getByTestId("transfer-receipt-to")).toHaveTextContent(
      DESTINATION,
    );
    expect(screen.getByTestId("transfer-receipt-amount")).toHaveTextContent(
      "250",
    );
    expect(screen.getByTestId("transfer-receipt-hash")).toHaveTextContent(
      "0xtransferhash",
    );
    expect(
      screen.getByTestId("transfer-receipt-timestamp").textContent,
    ).not.toBe("");
    expect(screen.getByText("Copy Tx Hash")).toBeInTheDocument();
    expect(screen.getByTestId("transfer-receipt-explorer")).toHaveAttribute(
      "href",
      "https://stellar.expert/explorer/testnet/tx/0xtransferhash",
    );

    expect(screen.getByLabelText("Destination address")).toHaveValue("");
    expect(screen.getByLabelText("Amount")).toHaveValue("");
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(onTransferConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        from: ADDRESS,
        to: DESTINATION,
        amount: 250n,
        hash: "0xtransferhash",
      }),
    );

    fireEvent.click(screen.getByTestId("transfer-receipt-close"));
    expect(screen.queryByTestId("transfer-receipt")).not.toBeInTheDocument();
  });

  it("copies the transaction hash from the receipt", async () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
      refetch: mockRefetch,
    });
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(
      <TransferScreen
        walletAddress={ADDRESS}
        explorerUrl="https://explorer.test/tx/"
      />,
    );
    fillForm(DESTINATION, "5");
    fireEvent.click(screen.getByTestId("transfer-submit"));

    await screen.findByTestId("transfer-receipt");
    expect(screen.getByTestId("transfer-receipt-explorer")).toHaveAttribute(
      "href",
      "https://explorer.test/tx/0xtransferhash",
    );
    fireEvent.click(screen.getByTestId("copy-to-clipboard-button"));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("0xtransferhash"),
    );
  });

  it("keeps the form and shows a helpful alert when the transfer is rejected", async () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
      refetch: mockRefetch,
    });
    mockTransfer.mockRejectedValue(new Error("User rejected the request"));

    const { rerender } = render(<TransferScreen walletAddress={ADDRESS} />);
    fillForm(DESTINATION, "10");
    fireEvent.click(screen.getByTestId("transfer-submit"));

    await waitFor(() => expect(mockTransfer).toHaveBeenCalledTimes(1));
    mockTransferState.error = new Error("User rejected the request");
    rerender(<TransferScreen walletAddress={ADDRESS} />);

    await waitFor(() =>
      expect(screen.getByTestId("transfer-error")).toHaveTextContent(
        "The transaction was rejected in your wallet.",
      ),
    );
    expect(screen.queryByTestId("transfer-receipt")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Destination address")).toHaveValue(
      DESTINATION,
    );
    expect(screen.getByLabelText("Amount")).toHaveValue("10");
    expect(mockRefetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("transfer-submit")).toBeEnabled();
  });

  it("shows a warning when the balance cannot be loaded", () => {
    mockUseBalance.mockReturnValue({
      data: null,
      loading: false,
      error: new Error("Network Error"),
      refetch: mockRefetch,
    });
    render(<TransferScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("transfer-balance-error")).toHaveTextContent(
      /network error/,
    );
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();
  });

  it("MAX fills the exact raw balance", () => {
    mockUseBalance.mockReturnValue({
      data: 123456789012345678901n,
      loading: false,
      error: null,
    });
    render(<TransferScreen walletAddress={ADDRESS} />);
    fireEvent.click(screen.getByTestId("transfer-max"));
    expect(screen.getByLabelText("Amount")).toHaveValue(
      "123456789012345678901",
    );
  });

  it("disables MAX when the balance is unknown or zero", () => {
    mockUseBalance.mockReturnValue({ data: null, loading: false, error: null });
    const { rerender } = render(<TransferScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("transfer-max")).toBeDisabled();
    mockUseBalance.mockReturnValue({ data: 0n, loading: false, error: null });
    rerender(<TransferScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("transfer-max")).toBeDisabled();
  });

  it("requests a fee estimate for a valid destination and amount", async () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
    });
    render(<TransferScreen walletAddress={ADDRESS} />);
    fireEvent.change(screen.getByLabelText("Destination address"), {
      target: { value: DESTINATION },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "5" },
    });
    await waitFor(() =>
      expect(mockEstimate).toHaveBeenCalledWith(ADDRESS, DESTINATION, 5n),
    );
  });

  it("shows the fee breakdown and recipient status", () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
    });
    mockFeeData = {
      feeStroops: 100n,
      feeXlm: "0.0000100",
      recipientExists: true,
    };
    render(<TransferScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("transfer-fee-xlm")).toHaveTextContent(
      "0.0000100",
    );
    expect(screen.getByTestId("transfer-recipient-status")).toHaveTextContent(
      "found",
    );
  });

  it("blocks submit and warns when the recipient does not exist", () => {
    mockUseBalance.mockReturnValue({
      data: 1_000n,
      loading: false,
      error: null,
    });
    mockFeeData = {
      feeStroops: 100n,
      feeXlm: "0.0000100",
      recipientExists: false,
    };
    render(<TransferScreen walletAddress={ADDRESS} />);
    fireEvent.change(screen.getByLabelText("Destination address"), {
      target: { value: DESTINATION },
    });
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "5" },
    });
    expect(
      screen.getByTestId("transfer-recipient-missing"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("transfer-submit")).toBeDisabled();
  });
});
