// SPDX-License-Identifier: MIT
import React, { useState } from "react";
import { Role } from "@bc-forge/sdk";
import {
  useHasRole,
  useMint,
  useSimulateTransaction,
  useWallet,
} from "../hooks";
import { truncatePublicKey } from "../context";
import { isPositiveInteger } from "../utils";
import { Alert } from "../components/Alert";
import { ExternalLink } from "../components/ExternalLink";
import { theme } from "../theme";

export type MintStep =
  "form" | "simulating" | "confirming" | "submitting" | "success";

const STEP_LABEL: Record<Exclude<MintStep, "form" | "success">, string> = {
  simulating: "Simulating transaction…",
  confirming: "Waiting for wallet signature…",
  submitting: "Submitting to network…",
};

export interface MintScreenProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
  /** Block explorer base URL, e.g. https://stellar.expert/explorer/testnet/tx */
  explorerUrl?: string;
}

/**
 * Token mint screen (#903, #1189, #1204, #1205, #1207, #1208, #1209).
 */
export const MintScreen: React.FC<MintScreenProps> = ({
  style,
  className,
  explorerUrl = "https://stellar.expert/explorer/testnet/tx",
}) => {
  const { publicKey, connected } = useWallet();
  const { mint, loading: mintLoading } = useMint();
  const { simulateMint, loading: simulating } = useSimulateTransaction();
  const { data: isMinter, loading: roleLoading } = useHasRole(
    Role.Minter,
    connected ? (publicKey ?? undefined) : undefined,
  );

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [step, setStep] = useState<MintStep>("form");
  const [simulatedFee, setSimulatedFee] = useState<string | null>(null);

  const trimmedRecipient = recipient.trim();
  const trimmedAmount = amount.trim();
  const recipientValid = trimmedRecipient.length > 0;
  const amountValid = isPositiveInteger(trimmedAmount);
  const lacksMinterRole = connected && isMinter === false;
  const isBusy =
    step === "simulating" ||
    step === "confirming" ||
    step === "submitting" ||
    mintLoading ||
    simulating;

  // Immediate validation for non-integer, negative, decimal, or exponential input (#1205)
  const amountValidationError = React.useMemo(() => {
    if (!amount) return null;
    const trimmed = amount.trim();
    if (trimmed === "") return "Amount cannot be blank.";
    if (trimmed.includes("-")) return "Amount cannot be negative.";
    if (trimmed.includes(".")) return "Amount cannot contain decimals.";
    if (/e/i.test(trimmed)) return "Amount cannot use exponential notation.";
    if (!/^\d+$/.test(trimmed))
      return "Amount must be a valid base-10 integer.";
    if (BigInt(trimmed) === 0n) return "Amount must be greater than zero.";
    return null;
  }, [amount]);

  const canSubmit =
    connected &&
    recipientValid &&
    amountValid &&
    !amountValidationError &&
    !isBusy &&
    !roleLoading &&
    !lacksMinterRole;

  const reset = () => {
    setRecipient("");
    setAmount("");
    setError(null);
    setTxHash(null);
    setSimulatedFee(null);
    setStep("form");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setTxHash(null);

    if (!connected || !publicKey) {
      setError("Connect a wallet before minting.");
      return;
    }
    if (lacksMinterRole) {
      setError("Minter role required to mint tokens.");
      return;
    }
    if (!recipientValid) {
      setError("Recipient address is required.");
      return;
    }
    if (!amountValid || amountValidationError) {
      setError(amountValidationError || "Amount must be a positive integer.");
      return;
    }

    const parsedAmount = BigInt(trimmedAmount);

    setStep("simulating");
    try {
      const { fee } = await simulateMint(
        trimmedRecipient,
        parsedAmount,
        publicKey,
      );
      setSimulatedFee(fee);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("form");
      return;
    }

    setStep("confirming");
    try {
      const result = await mint(trimmedRecipient, parsedAmount);
      setStep("submitting");
      if (result.success) {
        setTxHash(result.hash);
        setStep("success");
      } else {
        setError(`Mint failed with transaction hash: ${result.hash}`);
        setStep("form");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("form");
    }
  };

  return (
    <div
      className={className}
      data-testid="mint-screen"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        padding: "24px",
        maxWidth: "800px",
        margin: "0 auto",
        fontFamily: "inherit",
        ...style,
      }}
    >
      <div>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", fontWeight: 700 }}>
          Mint Tokens
        </h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: "14px" }}>
          Mint tokens to a recipient through the connected wallet.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          fontSize: "14px",
          color: "#4b5563",
        }}
      >
        <div>
          Signing account:{" "}
          <span
            data-testid="mint-connected-account"
            style={{ fontFamily: "monospace" }}
          >
            {connected && publicKey
              ? truncatePublicKey(publicKey)
              : "Not connected"}
          </span>
        </div>

        {connected && (
          <div
            data-testid="minter-role-indicator"
            style={{ display: "flex", alignItems: "center", gap: "8px" }}
          >
            Role status:{" "}
            {roleLoading ? (
              <span style={{ color: "#6b7280" }}>Verifying permissions…</span>
            ) : isMinter === true ? (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: "#dcfce7",
                  color: "#15803d",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                Minter Authorized
              </span>
            ) : isMinter === false ? (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: "#fee2e2",
                  color: "#b91c1c",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                Not Authorized (Minter Role Required)
              </span>
            ) : (
              <span style={{ color: "#6b7280" }}>Permission not verified</span>
            )}
          </div>
        )}
      </div>

      {lacksMinterRole && (
        <Alert
          variant="warning"
          title="Minter role required"
          data-testid="mint-role-warning"
        >
          The connected account does not hold the Minter role, so minting is
          disabled.
        </Alert>
      )}

      {amountValidationError && (
        <Alert
          variant="danger"
          title="Validation Error"
          data-testid="mint-amount-validation-error"
        >
          {amountValidationError}
        </Alert>
      )}

      {error && (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {isBusy && (
        <div
          data-testid="mint-progress-modal"
          role="status"
          aria-live="polite"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "16px",
            border: "1px solid #bfdbfe",
            borderRadius: "8px",
            backgroundColor: "#eff6ff",
            color: "#1e40af",
          }}
        >
          <span
            aria-hidden="true"
            data-testid="mint-progress-spinner"
            style={{
              width: 16,
              height: 16,
              border: "2px solid currentColor",
              borderRightColor: "transparent",
              borderRadius: "50%",
              display: "inline-block",
              animation: "spin 0.8s linear infinite",
            }}
          />
          <div>
            <div data-testid="mint-progress-step" style={{ fontWeight: 600 }}>
              {STEP_LABEL[step as Exclude<MintStep, "form" | "success">] ??
                "Processing…"}
            </div>
            {step !== "simulating" && simulatedFee !== null && (
              <div style={{ fontSize: "12px" }}>
                Estimated fee: {simulatedFee} stroops
              </div>
            )}
          </div>
        </div>
      )}

      {step === "success" && txHash && (
        <Alert
          variant="success"
          title="Mint Success"
          data-testid="mint-success-banner"
          onDismiss={() => setTxHash(null)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              Minted <strong>{trimmedAmount || amount}</strong> to{" "}
              <code>{truncatePublicKey(trimmedRecipient)}</code>.
            </div>
            <div>
              Transaction hash: <code data-testid="tx-hash">{txHash}</code>
            </div>
            {explorerUrl && (
              <ExternalLink
                href={`${explorerUrl.replace(/\/$/, "")}/${txHash}`}
                data-testid="mint-explorer-link"
              >
                View on Stellar Expert
              </ExternalLink>
            )}
            <button
              type="button"
              onClick={reset}
              data-testid="mint-another-button"
              style={{
                alignSelf: "flex-start",
                padding: "8px 14px",
                backgroundColor: theme.primary,
                color: "#ffffff",
                border: "none",
                borderRadius: "6px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Mint another
            </button>
          </div>
        </Alert>
      )}

      {step !== "success" && (
        <form
          onSubmit={handleSubmit}
          data-testid="mint-form"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            padding: "20px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              fontSize: "14px",
            }}
          >
            Recipient address
            <input
              type="text"
              name="recipient"
              placeholder="Recipient G... address"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              disabled={isBusy}
              style={{
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              The public Stellar account (G... or C... identifier) that will
              receive newly minted tokens.
            </span>
          </label>

          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              fontSize: "14px",
            }}
          >
            Amount
            <input
              type="text"
              name="amount"
              placeholder="Positive integer amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isBusy}
              style={{
                padding: "8px 12px",
                border: amountValidationError
                  ? "1px solid #ef4444"
                  : "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <span style={{ fontSize: "12px", color: "#6b7280" }}>
              Specify the token quantity in base units (must be a positive whole
              integer without decimals).
            </span>
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            data-testid="mint-submit"
            style={{
              padding: "10px 16px",
              backgroundColor: !canSubmit ? "#9ca3af" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 500,
              cursor: !canSubmit ? "not-allowed" : "pointer",
            }}
          >
            {isBusy ? "Minting…" : "Mint"}
          </button>
        </form>
      )}
    </div>
  );
};
