// SPDX-License-Identifier: MIT
import React, { useEffect, useMemo } from "react";
import { useWallet } from "../hooks";
import { truncatePublicKey, type WalletName } from "../context";
import { Alert } from "./Alert";
import {
  isMobileUserAgent,
  formatMobileWalletDeepLink,
  STELLAR_MOBILE_WALLETS,
  saveWalletConnectSession,
  loadWalletConnectSession,
  clearWalletConnectSession,
} from "../wallets/session";

export interface ConnectWalletProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
  /** Optional WalletConnect URI for deep-linking */
  wcUri?: string;
  /** Force mobile mode for deep linking (auto-detected by default) */
  isMobile?: boolean;
}

const BUTTON_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  backgroundColor: "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  fontWeight: 500,
  cursor: "pointer",
};

const DISCONNECT_STYLE: React.CSSProperties = {
  padding: "8px 14px",
  backgroundColor: "#ffffff",
  color: "#374151",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontWeight: 500,
  cursor: "pointer",
};

const DEEP_LINK_STYLE: React.CSSProperties = {
  padding: "6px 12px",
  backgroundColor: "#f3f4f6",
  color: "#1f2937",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontWeight: 500,
  fontSize: "13px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

/**
 * Wallet connect control (#902, #1491): pick Freighter or Albedo, show the
 * truncated connected public key, and disconnect. Connect errors are
 * surfaced through {@link Alert}.
 *
 * Supports mobile WalletConnect universal deep-linking (stellar://, lobstr://, xbull://)
 * and session reconnect persistence across reloads (#1491).
 */
export const ConnectWallet: React.FC<ConnectWalletProps> = ({
  style,
  className,
  wcUri,
  isMobile: isMobileProp,
}) => {
  const wallet = useWallet();
  const { name, publicKey, connected, status, connect, disconnect, error } =
    wallet;

  const isMobile = useMemo(
    () => isMobileProp ?? isMobileUserAgent(),
    [isMobileProp],
  );

  // Auto-reconnect session on mount if persisted session exists
  useEffect(() => {
    const saved = loadWalletConnectSession();
    if (saved?.walletName && !connected && status === "disconnected") {
      void connect(saved.walletName as WalletName);
    }
  }, [connected, status, connect]);

  // Sync connected session to persistence
  useEffect(() => {
    if (connected && publicKey && name) {
      saveWalletConnectSession({
        publicKey,
        walletName: name,
        connectedAt: Date.now(),
      });
    }
  }, [connected, publicKey, name]);

  const handleConnect = (targetWallet: WalletName) =>
    void connect(targetWallet);

  const handleDisconnect = () => {
    clearWalletConnectSession();
    void disconnect();
  };

  return (
    <div
      className={className}
      data-testid="connect-wallet"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        ...style,
      }}
    >
      {status === "wrong-network" ? (
        <Alert
          variant="warning"
          title="Network Mismatch Warning"
          data-testid="network-mismatch-warning"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <span>
              {error?.message ??
                "Wallet is connected to a different Stellar network."}
            </span>
            {Boolean(
              "expectedNetworkPassphrase" in wallet &&
              wallet.expectedNetworkPassphrase,
            ) && (
              <span style={{ fontSize: "12px" }}>
                Expected:{" "}
                <strong>{(wallet as any).expectedNetworkPassphrase}</strong>
              </span>
            )}
            {Boolean(
              "actualNetworkPassphrase" in wallet &&
              wallet.actualNetworkPassphrase,
            ) && (
              <span style={{ fontSize: "12px" }}>
                Actual:{" "}
                <strong>{(wallet as any).actualNetworkPassphrase}</strong>
              </span>
            )}
          </div>
        </Alert>
      ) : error ? (
        <Alert variant="danger" title="Wallet connection failed">
          {error.message}
        </Alert>
      ) : null}

      {connected && publicKey ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
          }}
        >
          <span
            data-testid="connected-wallet"
            style={{
              fontSize: "14px",
              fontFamily: "monospace",
              padding: "4px 10px",
              borderRadius: "12px",
              backgroundColor: "#f0fdf4",
              border: "1px solid #bbf7d0",
              color: "#166534",
            }}
          >
            {name}: {truncatePublicKey(publicKey)}
          </span>
          <button
            type="button"
            style={DISCONNECT_STYLE}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              type="button"
              data-testid="connect-freighter"
              style={BUTTON_STYLE}
              disabled={status === "connecting"}
              onClick={() => void handleConnect("freighter")}
            >
              {status === "connecting" && name === "freighter"
                ? "Connecting…"
                : "Connect Freighter"}
            </button>
            <button
              type="button"
              data-testid="connect-albedo"
              style={BUTTON_STYLE}
              disabled={status === "connecting"}
              onClick={() => void handleConnect("albedo")}
            >
              {status === "connecting" && name === "albedo"
                ? "Connecting…"
                : "Connect Albedo"}
            </button>
          </div>

          {isMobile && (
            <div
              data-testid="mobile-wallet-deep-links"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                marginTop: "4px",
                padding: "8px",
                backgroundColor: "#f9fafb",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
              }}
            >
              <span
                style={{ fontSize: "12px", fontWeight: 600, color: "#4b5563" }}
              >
                Open in Stellar Mobile Wallet:
              </span>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {STELLAR_MOBILE_WALLETS.map((w) => (
                  <a
                    key={w.id}
                    href={formatMobileWalletDeepLink(w.id, wcUri)}
                    data-testid={`deep-link-${w.id}`}
                    style={DEEP_LINK_STYLE}
                  >
                    {w.name}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
