// SPDX-License-Identifier: MIT
import {
  isMobileUserAgent,
  formatMobileWalletDeepLink,
  saveWalletConnectSession,
  loadWalletConnectSession,
  clearWalletConnectSession,
  WALLETCONNECT_SESSION_KEY,
  STELLAR_MOBILE_WALLETS,
} from "./session";

describe("wallets/session", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("isMobileUserAgent", () => {
    it("detects mobile user agents accurately", () => {
      const mobileUAs = [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15",
        "Mozilla/5.0 (iPod touch; CPU iPhone OS 14_0 like Mac OS X)",
        "Opera/9.80 (Android; Opera Mini/36.2.2254/119.132; U; id) Presto/2.12.423 Version/12.16",
      ];
      for (const ua of mobileUAs) {
        expect(isMobileUserAgent(ua)).toBe(true);
      }
    });

    it("rejects desktop user agents", () => {
      const desktopUAs = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0",
      ];
      for (const ua of desktopUAs) {
        expect(isMobileUserAgent(ua)).toBe(false);
      }
    });
  });

  describe("formatMobileWalletDeepLink", () => {
    it("returns direct scheme without wcUri", () => {
      expect(formatMobileWalletDeepLink("stellar")).toBe("stellar://");
      expect(formatMobileWalletDeepLink("lobstr")).toBe("lobstr://");
      expect(formatMobileWalletDeepLink("xbull")).toBe("xbull://");
    });

    it("formats universal/deep link with encoded wcUri", () => {
      const uri = "wc:12345@2?relay-protocol=irn&symKey=abc";
      const encoded = encodeURIComponent(uri);

      expect(formatMobileWalletDeepLink("stellar", uri)).toBe(
        `stellar://wc?uri=${encoded}`,
      );
      expect(formatMobileWalletDeepLink("lobstr", uri)).toBe(
        `lobstr://stellar.org/connect?uri=${encoded}`,
      );
      expect(formatMobileWalletDeepLink("xbull", uri)).toBe(
        `xbull://wc?uri=${encoded}`,
      );
    });

    it("has entries for all STELLAR_MOBILE_WALLETS", () => {
      expect(STELLAR_MOBILE_WALLETS.length).toBeGreaterThanOrEqual(3);
      for (const wallet of STELLAR_MOBILE_WALLETS) {
        const link = formatMobileWalletDeepLink(wallet.id);
        expect(link.startsWith(wallet.scheme)).toBe(true);
      }
    });
  });

  describe("session persistence", () => {
    it("saves and loads wallet connect session", () => {
      const session = {
        publicKey: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT",
        walletName: "freighter",
        uri: "wc:dummy-uri",
      };

      const saved = saveWalletConnectSession(session);
      expect(saved).toBe(true);

      const loaded = loadWalletConnectSession();
      expect(loaded).not.toBeNull();
      expect(loaded?.publicKey).toBe(session.publicKey);
      expect(loaded?.walletName).toBe(session.walletName);
      expect(loaded?.uri).toBe(session.uri);
      expect(typeof loaded?.connectedAt).toBe("number");
    });

    it("returns null when storage is empty or invalid", () => {
      expect(loadWalletConnectSession()).toBeNull();

      localStorage.setItem(WALLETCONNECT_SESSION_KEY, "invalid-json{{{");
      expect(loadWalletConnectSession()).toBeNull();
    });

    it("clears stored session on clearWalletConnectSession", () => {
      saveWalletConnectSession({
        publicKey: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT",
        walletName: "freighter",
      });
      expect(loadWalletConnectSession()).not.toBeNull();

      clearWalletConnectSession();
      expect(loadWalletConnectSession()).toBeNull();
      expect(localStorage.getItem(WALLETCONNECT_SESSION_KEY)).toBeNull();
    });
  });
});
