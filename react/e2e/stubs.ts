// SPDX-License-Identifier: MIT
import { Page } from "@playwright/test";
import { xdr, nativeToScVal } from "@stellar/stellar-sdk";

export const MOCK_PUBLIC_KEY =
  "GBX6IWES6LXR37NISD3DKBJSSWEGGY6UB5PSL3UVTJEZRIJ4GUPJAWVE";
export const MOCK_SIGNED_XDR = "AAAAF_FAKE_SIGNED_XDR";
export const MOCK_TX_HASH =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

/**
 * Installs the Freighter wallet stub script via `page.addInitScript` before navigation.
 */
export async function installFreighterStub(
  page: Page,
  optionsOrPk:
    | string
    | {
        publicKey?: string;
        networkPassphrase?: string;
        network?: string;
      } = MOCK_PUBLIC_KEY,
) {
  const pk =
    typeof optionsOrPk === "string"
      ? optionsOrPk
      : (optionsOrPk.publicKey ?? MOCK_PUBLIC_KEY);
  const passphrase =
    typeof optionsOrPk === "string"
      ? "Test SDF Network ; September 2015"
      : (optionsOrPk.networkPassphrase ?? "Test SDF Network ; September 2015");
  const network =
    typeof optionsOrPk === "string"
      ? "TESTNET"
      : (optionsOrPk.network ?? "TESTNET");

  await page.addInitScript(
    ({ pk, passphrase, network }) => {
      try {
        Object.defineProperty(Object.prototype, "hash", {
          get() {
            return this.txHash;
          },
          set(val) {
            Object.defineProperty(this, "hash", {
              value: val,
              writable: true,
              configurable: true,
              enumerable: true,
            });
          },
          configurable: true,
        });
      } catch {
        // ignore
      }

      (window as any).freighter = {
        isConnected: async () => true,
        getPublicKey: async () => pk,
        getNetworkDetails: async () => ({
          networkPassphrase: passphrase,
          network,
        }),
        getNetwork: async () => network,
        signTransaction: async (unsignedXdr: string) => unsignedXdr,
      };
    },
    { pk, passphrase, network },
  );
}

export interface NetworkStubOptions {
  balance?: bigint;
  hasRoles?: Record<string, boolean>;
  totalAssets?: bigint;
  totalShares?: bigint;
  sharePrice?: bigint;
  shareBalance?: bigint;
  nullApy?: boolean;
  mintError?: string;
}

/**
 * Intercepts network/RPC calls via `page.route` to eliminate testnet dependency.
 */
export async function installNetworkStubs(
  page: Page,
  options: NetworkStubOptions = {},
) {
  const balanceVal = options.balance ?? 1000n;
  const hasRoles = options.hasRoles ?? {
    Admin: false,
    SuperAdmin: true,
    Minter: true,
    Pauser: false,
  };
  const totalAssetsVal = options.totalAssets ?? 1000000n;
  const totalSharesVal = options.nullApy
    ? 0n
    : (options.totalShares ?? 100000n);
  const sharePriceVal = options.nullApy ? 0n : (options.sharePrice ?? 10n);
  const shareBalanceVal = options.shareBalance ?? 500n;

  await page.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      return route.continue();
    }

    let body: SorobanRpcRequest;
    try {
      body = request.postDataJSON() as SorobanRpcRequest;
    } catch {
      return route.continue();
    }

    if (!body || body.jsonrpc !== "2.0") {
      return route.continue();
    }

    const id = body.id ?? 1;
    const method = body.method;

    if (method === "getLatestLedger") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            sequence: 100000,
            id: "0000000000000000000000000000000000000000000000000000000000000000",
          },
        }),
      });
    }

    if (method === "getAccount") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            id: MOCK_PUBLIC_KEY,
            sequence: "1000",
          },
        }),
      });
    }

    if (method === "getLedgerEntries") {
      const keys = body.params?.keys ?? [];
      const entries = keys.map((keyB64: string) => {
        try {
          const ledgerKey = xdr.LedgerKey.fromXDR(keyB64, "base64");
          if (ledgerKey.switch() === xdr.LedgerEntryType.account()) {
            const accountId = ledgerKey.account().accountId();
            const accountEntry = new xdr.AccountEntry({
              accountId,
              balance: xdr.Int64.fromString("1000000000"),
              seqNum: xdr.SequenceNumber.fromString("1000"),
              numSubEntries: 0,
              inflationDest: null,
              flags: 0,
              homeDomain: "",
              thresholds: Buffer.from([1, 0, 0, 0]),
              signers: [],
              ext: new xdr.AccountEntryExt(0),
            });
            const ledgerEntryData = xdr.LedgerEntryData.account(accountEntry);
            return {
              key: keyB64,
              xdr: ledgerEntryData.toXDR("base64"),
              lastModifiedLedgerSeq: 100000,
            };
          }
        } catch {
          // ignore
        }
        return {
          key: keyB64,
          xdr: "AAAAAAAAAABv5FiS8u8d/aiQ9jUFMpWIY2PUD18l7pWaSZihPDUekAAAAAA7msoAAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAA",
          lastModifiedLedgerSeq: 100000,
        };
      });

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            latestLedger: 100000,
            entries,
          },
        }),
      });
    }

    if (method === "sendTransaction") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            status: "PENDING",
            hash: MOCK_TX_HASH,
          },
        }),
      });
    }

    if (method === "getTransaction") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            status: "SUCCESS",
            latestLedger: 100000,
            createdAt: 100000,
            applicationOrder: 1,
            feeBump: false,
            envelopeXdr:
              "AAAAAgAAAADHAl7Ke2RlF4ObEDdhwkhV+HQvjgpswKreLG9GyIURgwAAAAAAAAAAAAAAZQAAAAEAAAAAAAAAAAAAAABq1ExDAAAAAAAAAAAAAAAAAAAAAA==",
            resultXdr: "AAAAAAAAAGQAAAAAAAAAAAAAAAA=",
            resultMetaXdr: "AAAAAAAAAAA=",
          },
        }),
      });
    }

    if (method === "simulateTransaction") {
      const postData = request.postData() ?? "";
      let callData = postData;
      try {
        const txB64 = body?.params?.transaction;
        if (txB64) {
          callData = Buffer.from(txB64, "base64").toString("latin1") + postData;
        }
      } catch {
        // Fallback
      }
      let retvalXdr = "AAAAAQ=="; // default void (xdr.ScVal.scvVoid())

      if (callData.includes("total_assets")) {
        retvalXdr = nativeToScVal(totalAssetsVal, { type: "i128" }).toXDR(
          "base64",
        );
      } else if (callData.includes("calculate_share_price")) {
        retvalXdr = nativeToScVal(sharePriceVal, { type: "i128" }).toXDR(
          "base64",
        );
      } else if (callData.includes("share_balance")) {
        retvalXdr = nativeToScVal(shareBalanceVal, { type: "i128" }).toXDR(
          "base64",
        );
      } else if (callData.includes("supply")) {
        retvalXdr = nativeToScVal(totalSharesVal, { type: "i128" }).toXDR(
          "base64",
        );
      } else if (callData.includes("balance")) {
        retvalXdr = nativeToScVal(balanceVal, { type: "i128" }).toXDR("base64");
      } else if (callData.includes("has_role")) {
        let granted = false;
        for (const [roleName, isGranted] of Object.entries(hasRoles)) {
          if (callData.includes(roleName) && isGranted) {
            granted = true;
            break;
          }
        }
        retvalXdr = xdr.ScVal.scvBool(granted).toXDR("base64");
      } else if (callData.includes("name")) {
        retvalXdr = xdr.ScVal.scvString("DemoToken").toXDR("base64");
      } else if (callData.includes("symbol")) {
        retvalXdr = xdr.ScVal.scvString("DEMO").toXDR("base64");
      } else if (callData.includes("decimals")) {
        retvalXdr = xdr.ScVal.scvU32(7).toXDR("base64");
      }

      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            latestLedger: 100000,
            minResourceFee: "100",
            transactionData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            results: [
              {
                auth: [],
                xdr: retvalXdr,
              },
            ],
            retval: retvalXdr,
          },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {},
      }),
    });
  });
}
