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
export {
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
