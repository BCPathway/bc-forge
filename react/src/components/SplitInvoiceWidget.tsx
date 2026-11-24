// SPDX-License-Identifier: MIT
import React, { useState, useCallback, useMemo } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { Alert } from "./Alert";

export interface SplitRecipient {
  address: string;
  amount: string;
  isValid: boolean;
  error?: string;
}

export interface SplitInvoiceWidgetProps {
  /** Callback invoked when the user submits valid split invoice recipients */
  onSubmit?: (
    recipients: Array<{ address: string; amount: string }>,
    aggregateTotal: string,
  ) => Promise<void> | void;
  /** Whether the contract submission is currently processing */
  isSubmitting?: boolean;
  /** Maximum number of allowed recipients @default 100 */
  maxRecipients?: number;
  /** Optional initial CSV content to populate on mount */
  initialCsv?: string;
  /** Optional CSS class */
  className?: string;
  /** Optional container style */
  style?: React.CSSProperties;
}

/**
 * Validates a Stellar address using StrKey ed25519 public key checksum (#1492).
 */
export function validateStellarAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  try {
    return StrKey.isValidEd25519PublicKey(trimmed);
  } catch {
    return false;
  }
}

/**
 * Validates that an amount is a valid positive number string (#1492).
 */
export function validatePositiveAmount(amount: string): boolean {
  const trimmed = amount.trim();
  if (!trimmed) return false;
  const num = Number(trimmed);
  return !Number.isNaN(num) && num > 0 && Number.isFinite(num);
}

/**
 * Parses raw CSV string formatted as `address,amount` into validated recipient rows (#1492).
 */
export function parseSplitInvoiceCsv(rawCsv: string): SplitRecipient[] {
  if (!rawCsv || !rawCsv.trim()) return [];

  const lines = rawCsv.split(/\r?\n/);
  const rows: SplitRecipient[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]?.trim();
    if (!rawLine) continue;

    const parts = rawLine
      .split(",")
      .map((p) => p.trim().replace(/^["']|["']$/g, ""));
    if (parts.length < 2) {
      rows.push({
        address: rawLine,
        amount: "",
        isValid: false,
        error: "Missing amount column (expected address,amount)",
      });
      continue;
    }

    const address = parts[0] ?? "";
    const amount = parts[1] ?? "";

    // Skip potential header row (e.g. address,amount)
    if (
      i === 0 &&
      (address.toLowerCase() === "address" ||
        address.toLowerCase() === "recipient") &&
      (amount.toLowerCase() === "amount" || amount.toLowerCase() === "value")
    ) {
      continue;
    }

    const isAddrValid = validateStellarAddress(address);
    const isAmtValid = validatePositiveAmount(amount);

    if (!isAddrValid && !isAmtValid) {
      rows.push({
        address,
        amount,
        isValid: false,
        error: "Invalid Stellar address checksum and invalid positive amount",
      });
    } else if (!isAddrValid) {
      rows.push({
        address,
        amount,
        isValid: false,
        error: "Invalid Stellar address checksum",
      });
    } else if (!isAmtValid) {
      rows.push({
        address,
        amount,
        isValid: false,
        error: "Amount must be a positive number",
      });
    } else {
      rows.push({
        address,
        amount,
        isValid: true,
      });
    }
  }

  return rows;
}

/**
 * Dedicated Split Invoice Creation and Recipient CSV Upload Widget (#1492).
 *
 * Provides:
 * - Drag-and-drop CSV upload and manual textarea input.
 * - Validation of Stellar address checksums (StrKey) and positive amounts.
 * - Live parsed row preview with prominent error highlighting.
 * - Aggregate total calculation across recipients.
 * - Safe contract submission trigger.
 */
export const SplitInvoiceWidget: React.FC<SplitInvoiceWidgetProps> = ({
  onSubmit,
  isSubmitting = false,
  maxRecipients = 100,
  initialCsv = "",
  className,
  style,
}) => {
  const [csvText, setCsvText] = useState<string>(initialCsv);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const parsedRecipients = useMemo(
    () => parseSplitInvoiceCsv(csvText),
    [csvText],
  );

  const hasExceededMax = parsedRecipients.length > maxRecipients;
  const invalidRowsCount = parsedRecipients.filter((r) => !r.isValid).length;
  const hasErrors = invalidRowsCount > 0 || hasExceededMax;

  const aggregateTotal = useMemo(() => {
    let sum = 0;
    for (const r of parsedRecipients) {
      if (r.isValid) {
        sum += Number(r.amount);
      }
    }
    return sum.toFixed(7).replace(/\.?0+$/, "");
  }, [parsedRecipients]);

  const handleFileUpload = (file: File) => {
    setSubmitError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result;
      if (typeof content === "string") {
        setCsvText(content);
      }
    };
    reader.readAsText(file);
  };

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileUpload(file);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleSubmit = async () => {
    if (hasErrors || parsedRecipients.length === 0 || isSubmitting) return;
    setSubmitError(null);
    try {
      const validPayload = parsedRecipients.map(({ address, amount }) => ({
        address,
        amount,
      }));
      if (onSubmit) {
        await onSubmit(validPayload, aggregateTotal);
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div
      data-testid="split-invoice-widget"
      className={className}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        border: "1px solid #e5e7eb",
        borderRadius: "8px",
        padding: "20px",
        backgroundColor: "#ffffff",
        ...style,
      }}
    >
      <div>
        <h3 style={{ margin: "0 0 6px", fontSize: "18px", fontWeight: 600 }}>
          Create Split Invoice
        </h3>
        <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>
          Upload or paste a recipient CSV (`address,amount`). Address checksums
          and positive amounts are verified before submission.
        </p>
      </div>

      {submitError && (
        <Alert variant="danger" title="Submission Failed">
          {submitError}
        </Alert>
      )}

      {/* Drag & Drop zone */}
      <div
        data-testid="csv-dropzone"
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={{
          border: isDragOver ? "2px dashed #2563eb" : "2px dashed #d1d5db",
          borderRadius: "8px",
          padding: "20px",
          textAlign: "center",
          backgroundColor: isDragOver ? "#eff6ff" : "#f9fafb",
          transition: "all 0.2s ease",
          cursor: "pointer",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: "14px", fontWeight: 500, color: "#374151" }}>
            Drag and drop recipient CSV file here, or browse
          </span>
          <input
            data-testid="csv-file-input"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                handleFileUpload(file);
              }
            }}
            style={{ fontSize: "12px" }}
          />
        </div>
      </div>

      {/* Manual CSV Text Area */}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <label
          htmlFor="csv-textarea-input"
          style={{ fontSize: "13px", fontWeight: 600, color: "#374151" }}
        >
          Or paste CSV directly:
        </label>
        <textarea
          id="csv-textarea-input"
          data-testid="csv-textarea"
          rows={4}
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          placeholder={`GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT,25.5\nGAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ,14.0`}
          style={{
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid #d1d5db",
            fontFamily: "monospace",
            fontSize: "12px",
            width: "100%",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Aggregate stats banner */}
      {parsedRecipients.length > 0 && (
        <div
          data-testid="aggregate-summary"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 16px",
            backgroundColor: hasErrors ? "#fffbeb" : "#f0fdf4",
            borderRadius: "6px",
            border: `1px solid ${hasErrors ? "#fef3c7" : "#bbf7d0"}`,
            fontSize: "14px",
          }}
        >
          <div>
            <span style={{ fontWeight: 600 }}>Recipients: </span>
            <span>
              {parsedRecipients.length} total (
              {parsedRecipients.length - invalidRowsCount} valid
              {invalidRowsCount > 0 ? `, ${invalidRowsCount} invalid` : ""})
            </span>
          </div>
          <div data-testid="aggregate-total">
            <span style={{ fontWeight: 600 }}>Total Amount: </span>
            <span style={{ fontFamily: "monospace", fontWeight: 700 }}>
              {aggregateTotal || "0"} tokens
            </span>
          </div>
        </div>
      )}

      {hasExceededMax && (
        <Alert variant="danger">
          Exceeded maximum allowed recipients of {maxRecipients}. Current count:{" "}
          {parsedRecipients.length}.
        </Alert>
      )}

      {/* Parsed Row Preview Table with Error Highlighting */}
      {parsedRecipients.length > 0 && (
        <div
          data-testid="recipient-table"
          style={{
            maxHeight: "220px",
            overflowY: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "13px",
              textAlign: "left",
            }}
          >
            <thead>
              <tr
                style={{
                  backgroundColor: "#f3f4f6",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <th style={{ padding: "8px 12px" }}>#</th>
                <th style={{ padding: "8px 12px" }}>Stellar Address</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>
                  Amount
                </th>
                <th style={{ padding: "8px 12px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {parsedRecipients.map((recipient, idx) => (
                <tr
                  key={idx}
                  data-testid={`recipient-row-${idx}`}
                  style={{
                    backgroundColor: recipient.isValid ? "#ffffff" : "#fef2f2",
                    borderBottom: "1px solid #f3f4f6",
                  }}
                >
                  <td style={{ padding: "8px 12px", color: "#6b7280" }}>
                    {idx + 1}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      fontFamily: "monospace",
                      color: recipient.isValid ? "#111827" : "#991b1b",
                    }}
                  >
                    {recipient.address}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      textAlign: "right",
                      fontFamily: "monospace",
                      fontWeight: 600,
                    }}
                  >
                    {recipient.amount}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {recipient.isValid ? (
                      <span
                        data-testid={`recipient-valid-${idx}`}
                        style={{
                          fontSize: "12px",
                          color: "#166534",
                          backgroundColor: "#dcfce7",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontWeight: 500,
                        }}
                      >
                        Valid
                      </span>
                    ) : (
                      <span
                        data-testid={`recipient-error-${idx}`}
                        style={{
                          fontSize: "12px",
                          color: "#991b1b",
                          backgroundColor: "#fee2e2",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          fontWeight: 500,
                        }}
                      >
                        {recipient.error}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Action footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          marginTop: "4px",
        }}
      >
        <button
          type="button"
          data-testid="submit-split-invoice"
          onClick={() => void handleSubmit()}
          disabled={hasErrors || parsedRecipients.length === 0 || isSubmitting}
          style={{
            padding: "10px 20px",
            backgroundColor:
              hasErrors || parsedRecipients.length === 0 || isSubmitting
                ? "#9ca3af"
                : "#2563eb",
            color: "#ffffff",
            border: "none",
            borderRadius: "6px",
            fontWeight: 600,
            cursor:
              hasErrors || parsedRecipients.length === 0 || isSubmitting
                ? "not-allowed"
                : "pointer",
          }}
        >
          {isSubmitting ? "Submitting Invoice…" : "Submit Split Invoice"}
        </button>
      </div>
    </div>
  );
};
