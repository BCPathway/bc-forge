// src/context.tsx
import { createContext, useContext, useMemo } from "react";
import { bcForgeClient } from "@bc-forge/sdk";
import { jsx } from "react/jsx-runtime";
var bcForgeContext = createContext({ client: null });
var BcForgeProvider = ({ config, children }) => {
  const client = useMemo(() => new bcForgeClient(config), [config.rpcUrl, config.networkPassphrase, config.contractId]);
  return /* @__PURE__ */ jsx(bcForgeContext.Provider, { value: { client }, children });
};
var useBcForgeClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.client) {
    throw new Error("useBcForgeClient must be used within a BcForgeProvider");
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

// src/components/Dropdown.tsx
import React4, { forwardRef as forwardRef3, useState as useState2, useRef, useEffect as useEffect2 } from "react";
import { jsx as jsx4, jsxs as jsxs2 } from "react/jsx-runtime";
var TRIGGER_BASE = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  width: "100%",
  border: "1px solid",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
  lineHeight: 1.4,
  textAlign: "left",
  boxSizing: "border-box",
  transition: "border-color 0.15s, box-shadow 0.15s"
};
var TRIGGER_DISABLED = {
  opacity: 0.5,
  cursor: "not-allowed"
};
var SIZE_STYLES2 = {
  sm: { fontSize: 12, padding: "5px 8px", minHeight: 28 },
  md: { fontSize: 14, padding: "8px 12px", minHeight: 36 },
  lg: { fontSize: 16, padding: "12px 16px", minHeight: 44 }
};
var ITEM_SIZE_STYLES = {
  sm: { fontSize: 12, padding: "5px 8px" },
  md: { fontSize: 14, padding: "8px 12px" },
  lg: { fontSize: 16, padding: "10px 16px" }
};
var VARIANT_TRIGGER = {
  default: { borderColor: "#d1d5db", backgroundColor: "#ffffff", color: "#111827" },
  primary: { borderColor: "#2563eb", backgroundColor: "#2563eb", color: "#ffffff" },
  danger: { borderColor: "#dc2626", backgroundColor: "#dc2626", color: "#ffffff" }
};
var VARIANT_FOCUS = {
  default: { borderColor: "#6366f1", boxShadow: "0 0 0 2px rgba(99,102,241,0.15)" },
  primary: { boxShadow: "0 0 0 2px rgba(37,99,235,0.3)" },
  danger: { boxShadow: "0 0 0 2px rgba(220,38,38,0.3)" }
};
var ACTIVE_ITEM = {
  default: { backgroundColor: "#f3f4f6" },
  primary: { backgroundColor: "#eff6ff", color: "#2563eb" },
  danger: { backgroundColor: "#fef2f2", color: "#dc2626" }
};
var MENU_BASE = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 50,
  marginTop: 4,
  border: "1px solid #d1d5db",
  borderRadius: 6,
  backgroundColor: "#ffffff",
  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
  overflow: "hidden",
  boxSizing: "border-box"
};
var ITEM_BASE = {
  display: "block",
  width: "100%",
  border: "none",
  backgroundColor: "transparent",
  fontFamily: "inherit",
  lineHeight: 1.4,
  textAlign: "left",
  cursor: "pointer",
  boxSizing: "border-box",
  transition: "background-color 0.1s"
};
var ITEM_DISABLED = {
  opacity: 0.4,
  cursor: "not-allowed"
};
var WRAPPER_BASE = {
  position: "relative",
  display: "inline-block"
};
var ELLIPSIS = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
};
var CHEVRON = {
  display: "inline-block",
  border: "solid currentColor",
  borderWidth: "0 2px 2px 0",
  padding: 3,
  transition: "transform 0.15s",
  flexShrink: 0
};
function findFirstEnabled(items, start = 0) {
  for (let i = start; i < items.length; i++) {
    if (!items[i].disabled) return i;
  }
  for (let i = 0; i < start; i++) {
    if (!items[i].disabled) return i;
  }
  return -1;
}
function findLastEnabled(items) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (!items[i].disabled) return i;
  }
  return -1;
}
function findPrevEnabled(items, current) {
  for (let i = current - 1; i >= 0; i--) {
    if (!items[i].disabled) return i;
  }
  return findLastEnabled(items);
}
function findNextEnabled(items, current) {
  for (let i = current + 1; i < items.length; i++) {
    if (!items[i].disabled) return i;
  }
  return findFirstEnabled(items);
}
var Dropdown = forwardRef3(function Dropdown2({
  items,
  value,
  defaultValue,
  onChange,
  variant = "default",
  size = "md",
  placeholder = "Select...",
  disabled = false,
  style,
  ...rest
}, ref) {
  const [isOpen, setIsOpen] = useState2(false);
  const [activeIndex, setActiveIndex] = useState2(-1);
  const [internalValue, setInternalValue] = useState2(defaultValue ?? "");
  const isControlled = value !== void 0;
  const selectedValue = isControlled ? value : internalValue;
  const selectedItem = items.find((item) => item.value === selectedValue);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = React4.useId();
  function mergeRefs(node) {
    wrapperRef.current = node;
    if (typeof ref === "function") {
      ref(node);
    } else if (ref && typeof ref === "object") {
      ref.current = node;
    }
  }
  const activeDescendant = activeIndex >= 0 ? `${menuId}-item-${activeIndex}` : void 0;
  useEffect2(() => {
    if (!isOpen) return;
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);
  function selectItem(item) {
    if (item.disabled) return;
    if (!isControlled) {
      setInternalValue(item.value);
    }
    onChange?.(item);
    setIsOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }
  function handleTriggerClick() {
    if (disabled) return;
    setIsOpen((prev) => {
      if (!prev) {
        const idx = selectedItem ? items.indexOf(selectedItem) : -1;
        setActiveIndex(idx >= 0 ? idx : findFirstEnabled(items));
      } else {
        setActiveIndex(-1);
      }
      return !prev;
    });
  }
  function handleKeyDown(e) {
    if (disabled) return;
    if (!isOpen) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(findFirstEnabled(items));
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
        triggerRef.current?.focus();
        break;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => {
          const next = findNextEnabled(items, prev >= 0 ? prev : -1);
          return next >= 0 ? next : prev;
        });
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => {
          if (prev <= 0) {
            const last = findLastEnabled(items);
            return last >= 0 ? last : prev;
          }
          const next = findPrevEnabled(items, prev);
          return next >= 0 ? next : prev;
        });
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(findFirstEnabled(items));
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(findLastEnabled(items));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < items.length) {
          selectItem(items[activeIndex]);
        }
        break;
    }
  }
  function handleItemClick(item) {
    selectItem(item);
  }
  const chevronRotation = isOpen ? -135 : 45;
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      ref: mergeRefs,
      style: { ...WRAPPER_BASE, ...style },
      ...rest,
      children: [
        /* @__PURE__ */ jsxs2(
          "button",
          {
            ref: triggerRef,
            type: "button",
            "aria-haspopup": "menu",
            "aria-expanded": isOpen,
            "aria-controls": menuId,
            disabled,
            onClick: handleTriggerClick,
            onKeyDown: handleKeyDown,
            style: {
              ...TRIGGER_BASE,
              ...SIZE_STYLES2[size],
              ...VARIANT_TRIGGER[variant],
              ...disabled ? TRIGGER_DISABLED : {},
              ...isOpen ? VARIANT_FOCUS[variant] : {}
            },
            children: [
              /* @__PURE__ */ jsx4("span", { style: ELLIPSIS, children: selectedItem ? selectedItem.label : placeholder }),
              /* @__PURE__ */ jsx4(
                "span",
                {
                  "aria-hidden": "true",
                  style: {
                    ...CHEVRON,
                    transform: `rotate(${chevronRotation}deg)`,
                    marginTop: isOpen ? -1 : 1
                  }
                }
              )
            ]
          }
        ),
        isOpen && /* @__PURE__ */ jsx4(
          "div",
          {
            id: menuId,
            role: "menu",
            "aria-activedescendant": activeDescendant,
            style: MENU_BASE,
            children: items.map((item, index) => /* @__PURE__ */ jsx4(
              "button",
              {
                id: `${menuId}-item-${index}`,
                role: "menuitem",
                type: "button",
                disabled: item.disabled,
                tabIndex: -1,
                onClick: () => handleItemClick(item),
                onMouseEnter: () => setActiveIndex(index),
                style: {
                  ...ITEM_BASE,
                  ...ITEM_SIZE_STYLES[size],
                  ...index === activeIndex ? ACTIVE_ITEM[variant] : {},
                  ...item.disabled ? ITEM_DISABLED : {}
                },
                children: item.label
              },
              item.value
            ))
          }
        )
      ]
    }
  );
});
export {
  Alert,
  Badge,
  BcForgeProvider,
  Dropdown,
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
