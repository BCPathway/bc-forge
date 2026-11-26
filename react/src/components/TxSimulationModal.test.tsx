// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { TxSimulationModal, decodeSimulationError } from "./TxSimulationModal";

describe("TxSimulationModal (#1490)", () => {
  describe("decodeSimulationError", () => {
    it("decodes known contract error codes", () => {
      expect(decodeSimulationError(null, 1)).toContain("Minting is paused");
      expect(decodeSimulationError(null, "PAUSED")).toContain(
        "Minting is paused",
      );
      expect(decodeSimulationError(null, 2)).toContain("Rate limit exceeded");
      expect(decodeSimulationError(null, "RATE_LIMIT")).toContain(
        "Rate limit exceeded",
      );
      expect(decodeSimulationError(null, 3)).toContain("Unauthorized");
      expect(decodeSimulationError(null, 4)).toContain("Insufficient balance");
    });

    it("decodes error message strings matching common patterns", () => {
      expect(
        decodeSimulationError(new Error("Contract paused: minting is paused")),
      ).toContain("Minting is paused");
      expect(decodeSimulationError("HostError: rate limit reached")).toContain(
        "Rate limit exceeded",
      );
      expect(
        decodeSimulationError("Unauthorized transfer invocation"),
      ).toContain("Unauthorized caller");
    });

    it("returns raw message when unmapped", () => {
      const msg = "Some obscure custom revert reason";
      expect(decodeSimulationError(new Error(msg))).toBe(msg);
    });
  });

  describe("component rendering and actions", () => {
    const defaultProps = {
      open: true,
      onClose: jest.fn(),
      onConfirm: jest.fn(),
      estimatedFee: "1000",
      balanceChanges: [
        {
          asset: "USDC",
          symbol: "USDC",
          from: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT",
          to: "GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ",
          amount: "50.00",
        },
      ],
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("renders simulation preview with fee and balance changes on success", () => {
      render(<TxSimulationModal {...defaultProps} />);

      expect(
        screen.getByText("Transaction Simulation Preview"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("tx-sim-success-alert")).toBeInTheDocument();
      expect(screen.getByTestId("tx-sim-estimated-fee")).toBeInTheDocument();
      expect(screen.getByTestId("tx-sim-fee-value")).toHaveTextContent(
        /1000 stroops/,
      );
      expect(screen.getByTestId("tx-sim-balance-changes")).toBeInTheDocument();
      expect(screen.getByTestId("tx-sim-change-row-0")).toBeInTheDocument();
      expect(screen.getByText("50.00")).toBeInTheDocument();

      const confirmBtn = screen.getByTestId("tx-sim-confirm-button");
      expect(confirmBtn).not.toBeDisabled();
      fireEvent.click(confirmBtn);
      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1);

      const cancelBtn = screen.getByTestId("tx-sim-cancel-button");
      fireEvent.click(cancelBtn);
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    it("displays error diagnostics and disables confirm on simulation failure", () => {
      render(
        <TxSimulationModal
          {...defaultProps}
          error="Minting is paused"
          contractErrorCode={1}
        />,
      );

      expect(screen.getByTestId("tx-sim-error-alert")).toBeInTheDocument();
      expect(screen.getByTestId("tx-sim-error-message")).toHaveTextContent(
        /Minting is paused/,
      );

      const confirmBtn = screen.getByTestId("tx-sim-confirm-button");
      expect(confirmBtn).toBeDisabled();
      fireEvent.click(confirmBtn);
      expect(defaultProps.onConfirm).not.toHaveBeenCalled();
    });

    it("shows loading indicator while simulation is in flight", () => {
      render(<TxSimulationModal {...defaultProps} loading={true} />);

      expect(screen.getByTestId("tx-sim-loading")).toBeInTheDocument();
      expect(screen.getByTestId("tx-sim-confirm-button")).toBeDisabled();
    });
  });
});
