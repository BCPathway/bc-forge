// SPDX-License-Identifier: MIT
/**
 * Mobile WalletConnect Deep-Linking and Session Reconnect Persistence (#1491).
 */

import { isBrowser } from "./detection";

export const WALLETCONNECT_SESSION_KEY = "bc-forge:walletconnect-session";

export type MobileWalletScheme = "stellar" | "lobstr" | "xbull";

export interface MobileWalletOption {
  id: MobileWalletScheme;
  name: string;
  scheme: string;
  universalLink: string;
}

export const STELLAR_MOBILE_WALLETS: readonly MobileWalletOption[] = [
  {
    id: "stellar",
    name: "Stellar App",
    scheme: "stellar://",
    universalLink: "stellar://",
  },
  {
    id: "lobstr",
    name: "LOBSTR",
    scheme: "lobstr://",
    universalLink: "lobstr://",
  },
  {
    id: "xbull",
    name: "xBull",
    scheme: "xbull://",
    universalLink: "xbull://",
  },
];

export interface WalletConnectSession {
  topic?: string;
  uri?: string;
  publicKey?: string;
  walletName?: string;
  networkPassphrase?: string;
  connectedAt?: number;
}

/**
 * Detects if the current user agent (or passed user agent string) is a mobile device.
 */
export function isMobileUserAgent(userAgent?: string): boolean {
  if (userAgent !== undefined) {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent,
    );
  }
  if (!isBrowser()) return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent || navigator.vendor || "",
  );
}

/**
 * Renders direct universal / deep links for supported Stellar mobile wallets (stellar://, lobstr://, xbull://).
 */
export function formatMobileWalletDeepLink(
  wallet: MobileWalletScheme,
  wcUri?: string,
): string {
  const encodedUri = wcUri ? encodeURIComponent(wcUri) : "";
  switch (wallet) {
    case "stellar":
      return wcUri ? `stellar://wc?uri=${encodedUri}` : "stellar://";
    case "lobstr":
      return wcUri
        ? `lobstr://stellar.org/connect?uri=${encodedUri}`
        : "lobstr://";
    case "xbull":
      return wcUri ? `xbull://wc?uri=${encodedUri}` : "xbull://";
    default:
      return wcUri ? `stellar://wc?uri=${encodedUri}` : "stellar://";
  }
}

/**
 * Persists pairing session in localStorage so it survives page reloads.
 */
export function saveWalletConnectSession(
  session: WalletConnectSession,
): boolean {
  if (!isBrowser()) return false;
  try {
    window.localStorage.setItem(
      WALLETCONNECT_SESSION_KEY,
      JSON.stringify({
        ...session,
        connectedAt: session.connectedAt ?? Date.now(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Retrieves persisted pairing session from localStorage.
 */
export function loadWalletConnectSession(): WalletConnectSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(WALLETCONNECT_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WalletConnectSession;
  } catch {
    return null;
  }
}

/**
 * Clears stored pairing session on disconnect.
 */
export function clearWalletConnectSession(): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(WALLETCONNECT_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
}
