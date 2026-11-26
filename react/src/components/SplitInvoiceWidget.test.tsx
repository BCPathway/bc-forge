// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  SplitInvoiceWidget,
  validateStellarAddress,
  validatePositiveAmount,
  parseSplitInvoiceCsv,
} from "./SplitInvoiceWidget";

jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: jest.requireActual<{ StrKey: unknown }>(
    "../../../node_modules/@stellar/stellar-sdk/lib/cjs/base/strkey.js",
  ).StrKey,
}));

const VALID_ADDR_1 = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR";
const VALID_ADDR_2 = "GCATS5YOVB6ROX2WUNKGNQ2MP3GMXDMKSG2O4N5CLX3A6W4PZGZZI55U";
const INVALID_ADDR = "GBRPY_INVALID_CHECKSUM_NOT_A_VALID_STELLAR_KEY";

describe("SplitInvoiceWidget (#1492)", () => {
  describe("validation helpers", () => {
    it("validates Stellar address checksums with StrKey", () => {
      expect(validateStellarAddress(VALID_ADDR_1)).toBe(true);
      expect(validateStellarAddress(INVALID_ADDR)).toBe(false);
      expect(validateStellarAddress("")).toBe(false);
    });

    it("validates positive amounts", () => {
      expect(validatePositiveAmount("10")).toBe(true);
      expect(validatePositiveAmount("0.55")).toBe(true);
      expect(validatePositiveAmount("0")).toBe(false);
      expect(validatePositiveAmount("-5")).toBe(false);
      expect(validatePositiveAmount("not-a-number")).toBe(false);
    });

    it("parses CSV ignoring headers and whitespace", () => {
      const csv = `address,amount\n${VALID_ADDR_1},100\n${VALID_ADDR_2},50.5`;
      const rows = parseSplitInvoiceCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.isValid).toBe(true);
      expect(rows[0]!.amount).toBe("100");
      expect(rows[1]!.isValid).toBe(true);
      expect(rows[1]!.amount).toBe("50.5");
    });

    it("flags invalid rows in parsed CSV", () => {
      const csv = `${VALID_ADDR_1},-10\n${INVALID_ADDR},25`;
      const rows = parseSplitInvoiceCsv(csv);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.isValid).toBe(false);
      expect(rows[0]!.error).toContain("positive number");
      expect(rows[1]!.isValid).toBe(false);
      expect(rows[1]!.error).toContain("address checksum");
    });
  });

  describe("component interaction", () => {
    it("renders widget and updates state when typing CSV text", () => {
      const mockSubmit = jest.fn();
      render(<SplitInvoiceWidget onSubmit={mockSubmit} />);

      expect(screen.getByTestId("split-invoice-widget")).toBeInTheDocument();
      expect(screen.getByTestId("submit-split-invoice")).toBeDisabled();

      const textarea = screen.getByTestId("csv-textarea");
      fireEvent.change(textarea, {
        target: {
          value: `${VALID_ADDR_1},10\n${VALID_ADDR_2},20`,
        },
      });

      expect(screen.getByTestId("aggregate-total")).toHaveTextContent(
        "30 tokens",
      );
      expect(screen.getByTestId("recipient-row-0")).toBeInTheDocument();
      expect(screen.getByTestId("recipient-row-1")).toBeInTheDocument();
      expect(screen.getByTestId("recipient-valid-0")).toBeInTheDocument();
      expect(screen.getByTestId("recipient-valid-1")).toBeInTheDocument();

      const submitBtn = screen.getByTestId("submit-split-invoice");
      expect(submitBtn).not.toBeDisabled();
      fireEvent.click(submitBtn);

      expect(mockSubmit).toHaveBeenCalledTimes(1);
      expect(mockSubmit).toHaveBeenCalledWith(
        [
          { address: VALID_ADDR_1, amount: "10" },
          { address: VALID_ADDR_2, amount: "20" },
        ],
        "30",
      );
    });

    it("highlights invalid address or amount and disables submit button", () => {
      const mockSubmit = jest.fn();
      render(<SplitInvoiceWidget onSubmit={mockSubmit} />);

      const textarea = screen.getByTestId("csv-textarea");
      fireEvent.change(textarea, {
        target: {
          value: `${INVALID_ADDR},10\n${VALID_ADDR_1},-5`,
        },
      });

      expect(screen.getByTestId("recipient-error-0")).toHaveTextContent(
        /address checksum/i,
      );
      expect(screen.getByTestId("recipient-error-1")).toHaveTextContent(
        /positive/i,
      );
      expect(screen.getByTestId("submit-split-invoice")).toBeDisabled();

      fireEvent.click(screen.getByTestId("submit-split-invoice"));
      expect(mockSubmit).not.toHaveBeenCalled();
    });

    it("parses CSV uploaded via file input", async () => {
      render(<SplitInvoiceWidget />);
      const fileInput = screen.getByTestId("csv-file-input");

      const csvContent = `${VALID_ADDR_1},500\n`;
      const file = new File([csvContent], "invoice.csv", { type: "text/csv" });

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByTestId("recipient-row-0")).toBeInTheDocument();
      });
      expect(screen.getByTestId("aggregate-total")).toHaveTextContent(
        "500 tokens",
      );
    });

    it("enforces maxRecipients limit", () => {
      render(
        <SplitInvoiceWidget
          maxRecipients={1}
          initialCsv={`${VALID_ADDR_1},10\n${VALID_ADDR_2},20`}
        />,
      );

      expect(
        screen.getByText(/Exceeded maximum allowed recipients/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("submit-split-invoice")).toBeDisabled();
    });
  });
});
