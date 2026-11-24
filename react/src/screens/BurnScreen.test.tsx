// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BurnScreen } from "./BurnScreen";
import { useWallet } from "../context";

jest.mock("../context", () => ({
  useWallet: jest.fn(() => ({ connected: false })),
}));

const mockUseBalance = jest.fn();
const mockBurn = jest.fn();
const mockRefetchBalance = jest.fn();
const mockRefetchSupply = jest.fn();
const mockSupply: { data: bigint | null } = { data: 1000n };
const mockBurnState: { error: Error | null } = { error: null };

jest.mock("../hooks", () => ({
  useBalance: (...args: unknown[]) => mockUseBalance(...args),
  useTotalSupply: () => ({
    data: mockSupply.data,
    loading: false,
    error: null,
    refetch: mockRefetchSupply,
  }),
  useBurn: () => ({
    burn: mockBurn,
    loading: false,
    error: mockBurnState.error,
  }),
}));

const ADDRESS = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";

describe("BurnScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useWallet as jest.Mock).mockReturnValue({ connected: false });
    mockUseBalance.mockReturnValue({ data: null, loading: false, error: null });
    mockBurn.mockResolvedValue({ success: true, hash: "0xburnhash" });
    mockBurnState.error = null;
    mockSupply.data = 1000n;
    sessionStorage.clear();
  });

  const confirmBurn = () => {
    fireEvent.click(screen.getByTestId("confirmation-dialog-checkbox"));
    fireEvent.click(screen.getByTestId("confirmation-dialog-confirm"));
  };

  const openDialog = (amount: string) => {
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: amount },
    });
    fireEvent.click(screen.getByTestId("burn-submit"));
  };

  it("shows the connected balance and disables submit above it", () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen walletAddress={ADDRESS} />);

    expect(screen.getByTestId("burn-connected-address")).toHaveTextContent(
      ADDRESS,
    );
    expect(screen.getByTestId("burn-balance")).toHaveTextContent("500");

    // Valid amount is submittable.
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "100" },
    });
    expect(screen.getByTestId("burn-submit")).toBeEnabled();

    // Over balance: disabled and warned, and nothing was submitted.
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "501" },
    });
    expect(screen.getByTestId("burn-submit")).toBeDisabled();
    expect(screen.getByTestId("burn-over-balance")).toBeInTheDocument();
    expect(mockBurn).not.toHaveBeenCalled();

    // Not a positive integer: disabled.
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "0" },
    });
    expect(screen.getByTestId("burn-submit")).toBeDisabled();
  });

  it("submits a burn for the connected address and shows the transaction hash", async () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen walletAddress={ADDRESS} />);

    openDialog("100");
    confirmBurn();

    await waitFor(() => {
      expect(mockBurn).toHaveBeenCalledTimes(1);
    });
    expect(mockBurn).toHaveBeenCalledWith(ADDRESS, 100n);

    await waitFor(() => {
      expect(screen.getByTestId("burn-success")).toHaveTextContent(
        "Transaction hash: 0xburnhash",
      );
    });
    expect(screen.getByTestId("burn-success")).toHaveTextContent("0xburnhash");
    expect(screen.getAllByTestId("transaction-history-row")).toHaveLength(1);
  });

  it("uses the public key from the wallet context for balance and burn", async () => {
    (useWallet as jest.Mock).mockReturnValue({
      connected: true,
      publicKey: ADDRESS,
    });
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen />);

    expect(mockUseBalance).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByTestId("burn-connected-address")).toHaveTextContent(
      ADDRESS,
    );

    openDialog("100");
    confirmBurn();

    await waitFor(() => {
      expect(mockBurn).toHaveBeenCalledWith(ADDRESS, 100n);
    });
  });

  it("stays disconnected when the wallet context is not connected", () => {
    (useWallet as jest.Mock).mockReturnValue({ connected: false });
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen />);

    expect(screen.getByTestId("burn-connected-address")).toHaveTextContent(
      "Not connected",
    );
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "100" },
    });
    expect(screen.getByTestId("burn-submit")).toBeDisabled();
    expect(mockBurn).not.toHaveBeenCalled();
  });

  it("shows the burn error from the hook", () => {
    mockBurnState.error = new Error("simulation failed");
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });

    render(<BurnScreen walletAddress={ADDRESS} />);

    expect(screen.getByTestId("burn-error")).toHaveTextContent(
      "simulation failed",
    );
  });

  it("keeps Burn disabled in the dialog until the acknowledgement is checked", () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });
    render(<BurnScreen walletAddress={ADDRESS} />);

    openDialog("100");

    const confirm = screen.getByTestId("confirmation-dialog-confirm");
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockBurn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirmation-dialog-checkbox"));
    expect(confirm).toBeEnabled();
  });

  it("decrements total supply immediately and refetches balance and supply", async () => {
    mockUseBalance.mockReturnValue({
      data: 500n,
      loading: false,
      error: null,
      refetch: mockRefetchBalance,
    });
    render(<BurnScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("burn-total-supply")).toHaveTextContent("1000");

    openDialog("100");
    confirmBurn();

    await waitFor(() => {
      expect(screen.getByTestId("burn-total-supply")).toHaveTextContent("900");
    });
    expect(mockRefetchBalance).toHaveBeenCalledTimes(1);
    expect(mockRefetchSupply).toHaveBeenCalledTimes(1);
  });

  it("shows no success receipt and closes the dialog when the burn is rejected", async () => {
    mockBurn.mockRejectedValue(new Error("User rejected the request"));
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });
    render(<BurnScreen walletAddress={ADDRESS} />);

    openDialog("100");
    confirmBurn();

    await waitFor(() => {
      expect(
        screen.queryByTestId("confirmation-dialog"),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId("burn-success")).not.toBeInTheDocument();
    expect(screen.getByTestId("burn-total-supply")).toHaveTextContent("1000");
  });

  it("warns that burning is irreversible and styles the submit as danger", () => {
    render(<BurnScreen walletAddress={ADDRESS} />);

    expect(screen.getByTestId("burn-irreversible-warning")).toHaveTextContent(
      /irreversible/i,
    );
    expect(screen.getByTestId("burn-submit")).toHaveAttribute(
      "data-variant",
      "danger",
    );
  });

  it.each([
    ["0", "greater than zero"],
    ["-5", "positive whole number"],
    ["1.5", "positive whole number"],
    ["abc", "positive whole number"],
  ])("shows a validation message for %s", (value, message) => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });
    render(<BurnScreen walletAddress={ADDRESS} />);

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value } });

    expect(screen.getByTestId("burn-amount-error")).toHaveTextContent(message);
    expect(screen.getByTestId("burn-submit")).toBeDisabled();
  });

  it("shows no validation message for an empty amount", () => {
    render(<BurnScreen walletAddress={ADDRESS} />);
    expect(screen.queryByTestId("burn-amount-error")).not.toBeInTheDocument();
  });

  it("MAX fills the full balance and requires confirmation before burning", async () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });
    render(<BurnScreen walletAddress={ADDRESS} />);

    fireEvent.click(screen.getByTestId("burn-max"));

    expect(screen.getByLabelText("Amount")).toHaveValue("500");
    expect(screen.getByTestId("burn-max-confirm-warning")).toBeInTheDocument();
    expect(screen.getByTestId("burn-submit")).toBeDisabled();

    fireEvent.click(screen.getByLabelText(/burn my entire balance/i));
    expect(screen.getByTestId("burn-submit")).toBeEnabled();

    fireEvent.click(screen.getByTestId("burn-submit"));
    confirmBurn();
    await waitFor(() => expect(mockBurn).toHaveBeenCalledWith(ADDRESS, 500n));
  });

  it("editing the amount after MAX drops the confirmation requirement", () => {
    mockUseBalance.mockReturnValue({ data: 500n, loading: false, error: null });
    render(<BurnScreen walletAddress={ADDRESS} />);

    fireEvent.click(screen.getByTestId("burn-max"));
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "100" },
    });

    expect(
      screen.queryByTestId("burn-max-confirm-warning"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("burn-submit")).toBeEnabled();
  });

  it("disables MAX when balance is unknown or zero", () => {
    mockUseBalance.mockReturnValue({ data: 0n, loading: false, error: null });
    const { rerender } = render(<BurnScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("burn-max")).toBeDisabled();

    mockUseBalance.mockReturnValue({ data: null, loading: false, error: null });
    rerender(<BurnScreen walletAddress={ADDRESS} />);
    expect(screen.getByTestId("burn-max")).toBeDisabled();
  });
});
