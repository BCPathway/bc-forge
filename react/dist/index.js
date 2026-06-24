"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  bcForgeProvider: () => bcForgeProvider,
  useAllowance: () => useAllowance,
  useApprove: () => useApprove,
  useBalance: () => useBalance,
  useBcForgeClient: () => useBcForgeClient,
  useBcForgeToken: () => useBcForgeToken,
  useBurn: () => useBurn,
  useMint: () => useMint,
  useTotalSupply: () => useTotalSupply,
  useTransfer: () => useTransfer
});
module.exports = __toCommonJS(index_exports);

// src/context.tsx
var import_react = require("react");
var import_sdk = require("@bc-forge/sdk");
var import_jsx_runtime = require("react/jsx-runtime");
var bcForgeContext = (0, import_react.createContext)({ client: null });
var bcForgeProvider = ({ config, children }) => {
  const client = (0, import_react.useMemo)(() => new import_sdk.bcForgeClient(config), [config.rpcUrl, config.networkPassphrase, config.contractId]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(bcForgeContext.Provider, { value: { client }, children });
};
var useBcForgeClient = () => {
  const context = (0, import_react.useContext)(bcForgeContext);
  if (!context.client) {
    throw new Error("useBcForgeClient must be used within a bcForgeProvider");
  }
  return context.client;
};

// src/hooks.ts
var import_react2 = require("react");
function useBcForgeToken() {
  const client = useBcForgeClient();
  const [data, setData] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(true);
  const [error, setError] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [name, symbol, decimals] = await Promise.all([
          client.getName(),
          client.getSymbol(),
          client.getDecimals()
        ]);
        setData({ name, symbol, decimals });
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [client]);
  return { data, loading, error };
}
function useBalance(address) {
  const client = useBcForgeClient();
  const [data, setData] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const fetchBalance = (0, import_react2.useCallback)(async () => {
    if (!address) return;
    try {
      setLoading(true);
      const balance = await client.getBalance(address);
      setData(balance);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, address]);
  (0, import_react2.useEffect)(() => {
    fetchBalance();
  }, [fetchBalance]);
  return { data, loading, error, refetch: fetchBalance };
}
function useMint() {
  const client = useBcForgeClient();
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const mint = (0, import_react2.useCallback)(async (to, amount, source) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.mint(to, amount, source);
      return result;
    } catch (err) {
      const error2 = err instanceof Error ? err : new Error(String(err));
      setError(error2);
      throw error2;
    } finally {
      setLoading(false);
    }
  }, [client]);
  return { mint, loading, error };
}
function useTotalSupply() {
  const client = useBcForgeClient();
  const [data, setData] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const fetchTotalSupply = (0, import_react2.useCallback)(async () => {
    try {
      setLoading(true);
      const supply = await client.getTotalSupply();
      setData(supply);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client]);
  (0, import_react2.useEffect)(() => {
    fetchTotalSupply();
  }, [fetchTotalSupply]);
  return { data, loading, error, refetch: fetchTotalSupply };
}
function useTransfer() {
  const client = useBcForgeClient();
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const transfer = (0, import_react2.useCallback)(async (from, to, amount, source) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.transfer(from, to, amount, source);
      return result;
    } catch (err) {
      const error2 = err instanceof Error ? err : new Error(String(err));
      setError(error2);
      throw error2;
    } finally {
      setLoading(false);
    }
  }, [client]);
  return { transfer, loading, error };
}
function useApprove() {
  const client = useBcForgeClient();
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const approve = (0, import_react2.useCallback)(async (from, spender, amount, source) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.approve(from, spender, amount, source);
      return result;
    } catch (err) {
      const error2 = err instanceof Error ? err : new Error(String(err));
      setError(error2);
      throw error2;
    } finally {
      setLoading(false);
    }
  }, [client]);
  return { approve, loading, error };
}
function useBurn() {
  const client = useBcForgeClient();
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const burn = (0, import_react2.useCallback)(async (from, amount, source) => {
    try {
      setLoading(true);
      setError(null);
      const result = await client.burn(from, amount, source);
      return result;
    } catch (err) {
      const error2 = err instanceof Error ? err : new Error(String(err));
      setError(error2);
      throw error2;
    } finally {
      setLoading(false);
    }
  }, [client]);
  return { burn, loading, error };
}
function useAllowance(owner, spender) {
  const client = useBcForgeClient();
  const [data, setData] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)(null);
  const fetchAllowance = (0, import_react2.useCallback)(async () => {
    if (!owner || !spender) return;
    try {
      setLoading(true);
      const allowance = await client.getAllowance(owner, spender);
      setData(allowance);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [client, owner, spender]);
  (0, import_react2.useEffect)(() => {
    fetchAllowance();
  }, [fetchAllowance]);
  return { data, loading, error, refetch: fetchAllowance };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bcForgeProvider,
  useAllowance,
  useApprove,
  useBalance,
  useBcForgeClient,
  useBcForgeToken,
  useBurn,
  useMint,
  useTotalSupply,
  useTransfer
});
