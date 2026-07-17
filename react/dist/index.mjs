// src/context.tsx
import { createContext, useContext, useMemo } from "react";
import { bcForgeClient } from "@bc-forge/sdk";
import { jsx } from "react/jsx-runtime";
var bcForgeContext = createContext({ client: null });
var bcForgeProvider = ({ config, children }) => {
  const client = useMemo(() => new bcForgeClient(config), [config.rpcUrl, config.networkPassphrase, config.contractId]);
  return /* @__PURE__ */ jsx(bcForgeContext.Provider, { value: { client }, children });
};
var useBcForgeClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.client) {
    throw new Error("useBcForgeClient must be used within a bcForgeProvider");
  }
  return context.client;
};

// src/hooks.ts
import { useState, useEffect, useCallback } from "react";
function useBcForgeToken() {
  const client = useBcForgeClient();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchBalance = useCallback(async () => {
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
  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);
  return { data, loading, error, refetch: fetchBalance };
}
function useMint() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const mint = useCallback(async (to, amount, source) => {
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchTotalSupply = useCallback(async () => {
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
  useEffect(() => {
    fetchTotalSupply();
  }, [fetchTotalSupply]);
  return { data, loading, error, refetch: fetchTotalSupply };
}
function useTransfer() {
  const client = useBcForgeClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const transfer = useCallback(async (from, to, amount, source) => {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const approve = useCallback(async (from, spender, amount, source) => {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const burn = useCallback(async (from, amount, source) => {
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
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const fetchAllowance = useCallback(async () => {
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
  useEffect(() => {
    fetchAllowance();
  }, [fetchAllowance]);
  return { data, loading, error, refetch: fetchAllowance };
}

// src/components/Alert.tsx
import { forwardRef } from "react";
import { jsx as jsx2, jsxs } from "react/jsx-runtime";
var VARIANT_STYLES = {
  info: { backgroundColor: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" },
  success: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0", color: "#166534" },
  warning: { backgroundColor: "#fffbeb", borderColor: "#fde68a", color: "#92400e" },
  danger: { backgroundColor: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }
};
var Alert = forwardRef(function Alert2({ variant = "info", title, onDismiss, dismissLabel = "Dismiss alert", style, children, ...rest }, ref) {
  const defaultRole = variant === "danger" || variant === "warning" ? "alert" : "status";
  return /* @__PURE__ */ jsxs(
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
        /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
          title ? /* @__PURE__ */ jsx2("div", { style: { fontWeight: 700, marginBottom: 2 }, children: title }) : null,
          /* @__PURE__ */ jsx2("div", { style: { fontSize: 14 }, children })
        ] }),
        onDismiss ? /* @__PURE__ */ jsx2(
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
import { forwardRef as forwardRef2 } from "react";
import { jsx as jsx3 } from "react/jsx-runtime";
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
var Badge = forwardRef2(function Badge2({ variant = "default", size = "md", style, onClick, onKeyDown, children, ...rest }, ref) {
  const isInteractive = Boolean(onClick);
  const handleKeyDown = (e) => {
    if (isInteractive && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick(e);
    }
    onKeyDown?.(e);
  };
  return /* @__PURE__ */ jsx3(
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
export {
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
};
