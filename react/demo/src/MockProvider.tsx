import React, { ReactNode, createContext, useContext } from 'react';

/**
 * Minimal mock for @bc-forge/sdk bcForgeClient used by the demo.
 * All SDK calls resolve to sensible no-op values so the screens render
 * without a live RPC connection.  The wallet adapter stubs out Freighter
 * and Albedo so no browser extension is required.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = async (..._args: any[]) => ({} as any);

const mockClient = {
  getName: async () => import.meta.env.VITE_TOKEN_NAME ?? 'DemoToken',
  getSymbol: async () => import.meta.env.VITE_TOKEN_SYMBOL ?? 'DEMO',
  getDecimals: async () => 7,
  getBalance: async (_address: string) => 0n,
  getTotalSupply: async () => 0n,
  mint: noop,
  burn: noop,
  transfer: noop,
  approve: noop,
  getAllowance: async () => 0n,
  // VaultClient methods
  getTotalAssets: async () => 0n,
  calculateSharePrice: async () => 0n,
  getShareBalance: async () => 0n,
  deposit: noop,
  withdraw: noop,
};

// Mirror the shape of bcForgeContext so BcForgeProvider can be bypassed
interface MockContextType {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any;
}

const MockContext = createContext<MockContextType>({ client: mockClient });

export const useMockClient = () => useContext(MockContext).client;

interface MockProviderProps {
  children: ReactNode;
}

/**
 * Wraps the demo tree with a mock client context.
 * Freighter and Albedo are mocked at the browser boundary here so no
 * wallet extension is required for the smoke test to pass.
 */
export const MockProvider: React.FC<MockProviderProps> = ({ children }) => (
  <MockContext.Provider value={{ client: mockClient }}>
    {children}
  </MockContext.Provider>
);
