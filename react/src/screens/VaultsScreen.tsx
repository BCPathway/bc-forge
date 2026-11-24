// SPDX-License-Identifier: MIT
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { VaultClient, calculateApy } from "@bc-forge/sdk";
import type { ApyResult, WalletAdapter } from "@bc-forge/sdk";
import { Alert } from "../components/Alert";
import {
  TransactionToast,
  type TransactionToastStatus,
} from "../components/TransactionToast";
import { useOptionalBcForgeClient, useWalletContext } from "../context";
import { isPositiveInteger } from "../utils";

export interface VaultsScreenProps {
  /** Optional pre-instantiated VaultClient instance */
  client?: VaultClient;
  /** Soroban RPC endpoint URL */
  rpcUrl?: string;
  /** Stellar network passphrase */
  networkPassphrase?: string;
  /** Deployed vault contract ID */
  contractId?: string;
  /** Optional wallet adapter for connected wallet */
  walletAdapter?: WalletAdapter;
  /** Explicit connected wallet address (takes precedence or fallback for adapter) */
  walletAddress?: string;
  /** Optional historical lookback window in ledgers */
  lookbackLedgers?: number;
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
}

export const EMPTY_STATE_APY_MESSAGE =
  "Vault has no outstanding shares or insufficient historical data.";

function parseSlippageBps(value: string): bigint | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const bps = whole * 100n + fraction;
  return bps <= 10_000n ? bps : null;
}

function minimumAfterSlippage(amount: bigint, slippageBps: bigint): bigint {
  return (amount * (10_000n - slippageBps)) / 10_000n;
}

function quoteUnderlying(
  shares: bigint,
  assets: bigint | null,
  supply: bigint | null,
): bigint | null {
  if (assets === null || supply === null || supply <= 0n) return null;
  return (shares * assets) / supply;
}

export const VaultsScreen: React.FC<VaultsScreenProps> = ({
  client,
  rpcUrl,
  networkPassphrase,
  contractId,
  walletAdapter,
  walletAddress,
  lookbackLedgers,
  style,
  className,
}) => {
  const [totalAssets, setTotalAssets] = useState<bigint | null>(null);
  const [totalShares, setTotalShares] = useState<bigint | null>(null);
  const [sharePrice, setSharePrice] = useState<bigint | null>(null);
  const [shareBalance, setShareBalance] = useState<bigint | null>(null);
  const [tokenBalance, setTokenBalance] = useState<bigint | null>(null);
  const [apyResult, setApyResult] = useState<ApyResult | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [slippageChoice, setSlippageChoice] = useState("0.5");
  const [customSlippage, setCustomSlippage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    status: TransactionToastStatus;
    hash?: string;
    message?: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);

  const walletCtx = useWalletContext();
  const contextClient = useOptionalBcForgeClient();
  const effectiveAdapter =
    walletAdapter ??
    walletCtx?.adapter ??
    (contextClient as any)?.getWalletAdapter?.() ??
    undefined;
  const connectedAddress =
    walletAddress ||
    (effectiveAdapter?.connected ? effectiveAdapter.publicKey : undefined) ||
    effectiveAdapter?.publicKey;

  const isConnected = Boolean(connectedAddress);
  const slippageBps = parseSlippageBps(
    slippageChoice === "custom" ? customSlippage : slippageChoice,
  );
  const parsedDepositAmount = isPositiveInteger(depositAmount)
    ? BigInt(depositAmount.trim())
    : null;
  const depositDisabled =
    !isConnected ||
    isSubmitting ||
    tokenBalance === null ||
    (parsedDepositAmount !== null && parsedDepositAmount > tokenBalance);
  const estimatedDepositShares =
    parsedDepositAmount === null
      ? null
      : totalShares === 0n
        ? parsedDepositAmount
        : totalAssets !== null && totalAssets > 0n && totalShares !== null
          ? (parsedDepositAmount * totalShares) / totalAssets
          : null;
  const parsedWithdrawAmount = isPositiveInteger(withdrawAmount)
    ? BigInt(withdrawAmount.trim())
    : null;
  const withdrawEstimate =
    parsedWithdrawAmount === null
      ? null
      : quoteUnderlying(parsedWithdrawAmount, totalAssets, totalShares);
  const positionValue =
    shareBalance === null
      ? null
      : quoteUnderlying(shareBalance, totalAssets, totalShares);

  const activeClient = useMemo(() => {
    if (client) return client;
    if (rpcUrl && networkPassphrase && contractId) {
      return new VaultClient({
        rpcUrl,
        networkPassphrase,
        contractId,
        walletAdapter: effectiveAdapter,
      });
    }
    return null;
  }, [client, rpcUrl, networkPassphrase, contractId, effectiveAdapter]);

  const activeRpcUrl =
    rpcUrl || (activeClient as unknown as { rpcUrl?: string })?.rpcUrl;
  const activePassphrase =
    networkPassphrase ||
    (activeClient as unknown as { networkPassphrase?: string })
      ?.networkPassphrase;
  const activeContractId =
    contractId ||
    (activeClient as unknown as { contractId?: string })?.contractId;

  const loadData = useCallback(async () => {
    if (!activeClient) return;
    setIsLoadingMetrics(true);
    try {
      const [assets, shares, price] = await Promise.all([
        activeClient.getTotalAssets().catch(() => 0n),
        activeClient.getTotalSupply().catch(() => 0n),
        activeClient.calculateSharePrice().catch(() => 0n),
      ]);
      setTotalAssets(assets);
      setTotalShares(shares);
      setSharePrice(price);

      if (connectedAddress) {
        const [shares, tokens] = await Promise.all([
          activeClient.getShareBalance(connectedAddress).catch(() => 0n),
          activeClient.getUnderlyingBalance(connectedAddress).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            setError(`Unable to load token balance: ${message}`);
            return null;
          }),
        ]);
        setShareBalance(shares);
        setTokenBalance(tokens);
      } else {
        setShareBalance(null);
        setTokenBalance(null);
      }

      if (activeRpcUrl && activePassphrase && activeContractId) {
        try {
          const apy = await calculateApy({
            rpcUrl: activeRpcUrl,
            networkPassphrase: activePassphrase,
            contractId: activeContractId,
            lookbackLedgers,
          });
          setApyResult(apy);
        } catch {
          setApyResult(null);
        }
      } else {
        setApyResult(null);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setIsLoadingMetrics(false);
    }
  }, [
    activeClient,
    connectedAddress,
    activeRpcUrl,
    activePassphrase,
    activeContractId,
    lookbackLedgers,
  ]);

  useEffect(() => {
    void loadData();
    const interval = window.setInterval(() => {
      void loadData();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const handleDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setToast(null);

    if (!connectedAddress || !activeClient) {
      setError("Wallet must be connected to deposit");
      return;
    }

    const trimmed = depositAmount.trim();
    if (!isPositiveInteger(trimmed)) {
      setError("Deposit amount must be a positive integer");
      return;
    }

    const amountBigInt = BigInt(trimmed);
    if (slippageBps === null) {
      setError("Enter a slippage tolerance between 0 and 100%.");
      return;
    }
    if (estimatedDepositShares === null) {
      setError(
        "Deposit quote is unavailable. Refresh vault metrics and try again.",
      );
      return;
    }

    setToast({ status: "pending" });
    setIsSubmitting(true);
    try {
      const result = await activeClient.deposit(
        connectedAddress,
        amountBigInt,
        (effectiveAdapter ?? walletAdapter) as any,
        minimumAfterSlippage(estimatedDepositShares, slippageBps),
      );
      if (result && result.success) {
        setToast({ status: "success", hash: result.hash });
        setDepositAmount("");
        await loadData();
      } else {
        setToast({
          status: "error",
          hash: result?.hash,
          message: result?.hash
            ? `Deposit failed with transaction hash: ${result.hash}`
            : "Deposit transaction failed",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast({ status: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setToast(null);

    if (!connectedAddress || !activeClient) {
      setError("Wallet must be connected to withdraw");
      return;
    }

    const trimmed = withdrawAmount.trim();
    if (!isPositiveInteger(trimmed)) {
      setError("Withdraw amount must be a positive integer");
      return;
    }

    const sharesBigInt = BigInt(trimmed);
    const quote =
      parsedWithdrawAmount === sharesBigInt ? withdrawEstimate : null;
    if (quote === null) {
      setError(
        "Withdrawal quote is unavailable. Please wait for the estimate and try again.",
      );
      return;
    }
    if (slippageBps === null) {
      setError("Enter a slippage tolerance between 0 and 100%.");
      return;
    }

    setToast({ status: "pending" });
    setIsSubmitting(true);
    try {
      const result = await activeClient.withdraw(
        connectedAddress,
        sharesBigInt,
        (effectiveAdapter ?? walletAdapter) as any,
        minimumAfterSlippage(quote, slippageBps),
      );
      if (result && result.success) {
        setToast({ status: "success", hash: result.hash });
        setWithdrawAmount("");
        await loadData();
      } else {
        setToast({
          status: "error",
          hash: result?.hash,
          message: result?.hash
            ? `Withdraw failed with transaction hash: ${result.hash}`
            : "Withdraw transaction failed",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToast({ status: "error", message });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className={className}
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
          Vaults Dashboard
        </h1>
        <p style={{ margin: 0, color: "#4b5563", fontSize: "14px" }}>
          Overview of yield-bearing fee vault metrics and deposit/withdraw
          controls.
        </p>
      </div>

      {error && (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {toast && (
        <div data-testid="tx-hash-container">
          <TransactionToast
            status={toast.status}
            hash={toast.hash}
            error={toast.message}
            label={toast.status === "pending" ? "Vault transaction" : undefined}
            onDismiss={() => setToast(null)}
          />
          {toast.hash ? (
            <div
              data-testid="tx-hash"
              style={{ fontSize: "12px", color: "#4b5563", marginTop: "4px" }}
            >
              {toast.hash}
            </div>
          ) : null}
        </div>
      )}

      {!isConnected && (
        <Alert
          variant="warning"
          title="Wallet not connected"
          data-testid="vaults-wallet-disconnected-alert"
        >
          Connect your wallet to manage vault shares and deposits.
        </Alert>
      )}

      {/* Metrics Section */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "16px",
        }}
      >
        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            Total Assets
          </div>
          <div
            data-testid="total-assets"
            style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px" }}
          >
            {totalAssets !== null
              ? totalAssets.toString()
              : isLoadingMetrics
                ? "Loading..."
                : "0"}
          </div>
        </div>

        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            Total Shares
          </div>
          <div
            data-testid="total-shares"
            style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px" }}
          >
            {totalShares !== null
              ? totalShares.toString()
              : isLoadingMetrics
                ? "Loading..."
                : "0"}
          </div>
        </div>

        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            Share Price
          </div>
          <div
            data-testid="share-price"
            style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px" }}
          >
            {sharePrice !== null
              ? sharePrice.toString()
              : isLoadingMetrics
                ? "Loading..."
                : "0"}
          </div>
        </div>

        <div
          style={{
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: "#6b7280",
              textTransform: "uppercase",
            }}
          >
            Your Share Balance
          </div>
          <div
            data-testid="share-balance"
            style={{ fontSize: "20px", fontWeight: 600, marginTop: "4px" }}
          >
            {isConnected
              ? shareBalance !== null
                ? shareBalance.toString()
                : isLoadingMetrics
                  ? "Loading..."
                  : "0"
              : "Disconnected"}
          </div>
        </div>
      </div>

      <section
        aria-labelledby="vault-position-title"
        data-testid="vault-position"
        style={{
          padding: "16px",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
        }}
      >
        <h2
          id="vault-position-title"
          style={{ margin: "0 0 12px", fontSize: "18px" }}
        >
          Your Vault Position
        </h2>
        <div>
          Shares owned:{" "}
          <span data-testid="position-shares">
            {shareBalance?.toString() ?? "—"}
          </span>
        </div>
        <div>
          Estimated value:{" "}
          <span data-testid="position-value">
            {positionValue?.toString() ?? "—"}
          </span>{" "}
          tokens
        </div>
        <div>
          Estimated yield vs. 1:1 share basis:{" "}
          <span data-testid="position-yield">
            {positionValue === null || shareBalance === null
              ? "—"
              : (positionValue - shareBalance).toString()}
          </span>{" "}
          tokens
        </div>
      </section>

      {/* APY Section */}
      <div
        style={{
          padding: "16px",
          border: "1px solid #e5e7eb",
          borderRadius: "8px",
          backgroundColor: "#f9fafb",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            color: "#6b7280",
            textTransform: "uppercase",
          }}
        >
          Current Vault APY
        </div>
        <div
          data-testid="vault-apy"
          style={{ fontSize: "18px", fontWeight: 600, marginTop: "4px" }}
        >
          {apyResult !== null ? (
            `${(apyResult.apy * 100).toFixed(2)}%`
          ) : (
            <span
              style={{ fontSize: "14px", fontWeight: 400, color: "#4b5563" }}
            >
              {EMPTY_STATE_APY_MESSAGE}
            </span>
          )}
        </div>
      </div>

      {/* Action Forms */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "20px",
        }}
      >
        {/* Deposit Form */}
        <form
          onSubmit={handleDeposit}
          data-testid="deposit-form"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            padding: "20px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            Deposit Assets
          </h2>
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
              name="depositAmount"
              placeholder="Enter positive integer amount"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              disabled={!isConnected || isSubmitting}
              style={{
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
                fontSize: "14px",
                outline: "none",
              }}
            />
          </label>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              fontSize: "14px",
            }}
          >
            Slippage tolerance
            <select
              aria-label="Slippage tolerance"
              value={slippageChoice}
              onChange={(e) => setSlippageChoice(e.target.value)}
              disabled={isSubmitting}
              style={{
                padding: "8px 12px",
                border: "1px solid #d1d5db",
                borderRadius: "6px",
              }}
            >
              <option value="0.5">0.5%</option>
              <option value="1.0">1.0%</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {slippageChoice === "custom" && (
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                fontSize: "14px",
              }}
            >
              Custom slippage (%)
              <input
                aria-label="Custom slippage (%)"
                inputMode="decimal"
                value={customSlippage}
                onChange={(e) => setCustomSlippage(e.target.value)}
                disabled={isSubmitting}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                }}
              />
            </label>
          )}
          <div
            data-testid="deposit-share-estimate"
            style={{ fontSize: "13px", color: "#4b5563" }}
          >
            {estimatedDepositShares === null
              ? "Enter an amount to preview shares."
              : `Estimated shares: ${estimatedDepositShares.toString()}`}
          </div>
          <div
            data-testid="token-balance"
            style={{ fontSize: "13px", color: "#4b5563" }}
          >
            Token balance:{" "}
            {tokenBalance === null
              ? isConnected
                ? isLoadingMetrics
                  ? "Loading..."
                  : "Unavailable"
                : "Disconnected"
              : tokenBalance.toString()}
          </div>
          <button
            type="submit"
            disabled={depositDisabled}
            style={{
              padding: "10px 16px",
              backgroundColor: depositDisabled ? "#9ca3af" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 500,
              cursor: depositDisabled ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Processing..." : "Deposit"}
          </button>
        </form>

        {/* Withdraw Form */}
        <form
          onSubmit={handleWithdraw}
          data-testid="withdraw-form"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            padding: "20px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            Withdraw Shares
          </h2>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              fontSize: "14px",
            }}
          >
            Shares
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                name="withdrawAmount"
                data-testid="withdraw-shares-input"
                placeholder="Enter positive integer shares"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={!isConnected || isSubmitting}
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  outline: "none",
                }}
              />
              <button
                type="button"
                data-testid="max-withdraw-btn"
                disabled={
                  !isConnected ||
                  isSubmitting ||
                  shareBalance === null ||
                  shareBalance <= 0n
                }
                onClick={() => {
                  if (shareBalance !== null) {
                    setWithdrawAmount(shareBalance.toString());
                  }
                }}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: "6px",
                  fontSize: "14px",
                  backgroundColor: "#f3f4f6",
                  cursor:
                    !isConnected ||
                    isSubmitting ||
                    shareBalance === null ||
                    shareBalance <= 0n
                      ? "not-allowed"
                      : "pointer",
                }}
              >
                MAX
              </button>
            </div>
          </label>
          <div
            data-testid="withdraw-estimate"
            style={{ fontSize: "13px", color: "#4b5563" }}
          >
            {withdrawEstimate !== null
              ? `You will receive ~${withdrawEstimate.toString()} tokens (no withdrawal fee)`
              : "Enter an amount to preview tokens returned."}
          </div>
          <button
            type="submit"
            disabled={
              !isConnected ||
              isSubmitting ||
              shareBalance === null ||
              shareBalance === 0n ||
              parsedWithdrawAmount === null ||
              parsedWithdrawAmount <= 0n ||
              parsedWithdrawAmount > shareBalance
            }
            style={{
              padding: "10px 16px",
              backgroundColor:
                !isConnected || isSubmitting ? "#9ca3af" : "#2563eb",
              color: "#ffffff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 500,
              cursor: !isConnected || isSubmitting ? "not-allowed" : "pointer",
            }}
          >
            {isSubmitting ? "Processing..." : "Withdraw"}
          </button>
        </form>
      </div>
    </div>
  );
};
