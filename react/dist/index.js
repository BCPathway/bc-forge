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
  Alert: () => Alert,
  Badge: () => Badge,
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

// src/components/Alert.tsx
var import_react3 = require("react");
var import_jsx_runtime2 = require("react/jsx-runtime");
var VARIANT_STYLES = {
  info: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" },
  success: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" },
  warning: { backgroundColor: "#fffbeb", borderColor: "#fde68a", color: "#92400e" },
  danger: { backgroundColor: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }
};
var Alert = (0, import_react3.forwardRef)(function Alert2({ variant = "info", title, onDismiss, dismissLabel = "Dismiss alert", style, children, ...rest }, ref) {
  const defaultRole = variant === "danger" || variant === "warning" ? "alert" : "status";
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
    "div",
    {
      ref,
      role: defaultRole,
      style: {
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "12px 14px",
        border: "1px solid",
        borderRadius: 8,
        ...VARIANT_STYLES[variant],
        ...style
      },
      ...rest,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
          title ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontWeight: 700, marginBottom: 2 }, children: title }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { fontSize: 14 }, children })
        ] }),
        onDismiss ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            onClick: onDismiss,
            "aria-label": dismissLabel,
            style: {
              flexShrink: 0,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "inherit",
              fontSize: 18,
              lineHeight: 1,
              padding: 2
            },
            children: "\xD7"
          }
        ) : null
      ]
    }
  );
});

// src/components/Badge.tsx
var import_react4 = require("react");
var import_jsx_runtime3 = require("react/jsx-runtime");
var VARIANT_STYLES2 = {
  default: { backgroundColor: "#f3f4f6", color: "#374151" },
  primary: { backgroundColor: "#eff6ff", color: "#1e40af" },
  success: { backgroundColor: "#f0fdf4", color: "#166534" },
  warning: { backgroundColor: "#fffbeb", color: "#92400e" },
  danger: { backgroundColor: "#fef2f2", color: "#991b1b" },
  info: { backgroundColor: "#ecfeff", color: "#155e75" }
};
var SIZE_STYLES = {
  sm: { fontSize: 11, padding: "1px 6px", borderRadius: 8 },
  md: { fontSize: 12, padding: "2px 8px", borderRadius: 10 },
  lg: { fontSize: 14, padding: "3px 10px", borderRadius: 12 }
};
var BADGE_BASE = {
  display: "inline-flex",
  alignItems: "center",
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: "nowrap"
};
var Badge = (0, import_react4.forwardRef)(function Badge2({ variant = "default", size = "md", style, onClick, onKeyDown, children, ...rest }, ref) {
  const isInteractive = Boolean(onClick);
  const handleKeyDown = (e) => {
    if (isInteractive && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick(e);
    }
    onKeyDown?.(e);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
    "span",
    {
      ref,
      role: isInteractive ? "button" : void 0,
      tabIndex: isInteractive ? 0 : void 0,
      style: {
        ...BADGE_BASE,
        ...VARIANT_STYLES2[variant],
        ...SIZE_STYLES[size],
        ...isInteractive ? { cursor: "pointer" } : {},
        ...style
      },
      onClick,
      onKeyDown: handleKeyDown,
      ...rest,
      children
    }
  );
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Alert,
  Badge,
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
