import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { bcForgeClient, bcForgeClientConfig } from '@bc-forge/sdk';

interface bcForgeContextType {
  client: bcForgeClient | null;
}

const bcForgeContext = createContext<bcForgeContextType>({ client: null });

export interface BcForgeProviderProps {
  config: bcForgeClientConfig;
  children: ReactNode;
}

export const BcForgeProvider: React.FC<BcForgeProviderProps> = ({ config, children }) => {
  const client = useMemo(() => new bcForgeClient(config), [config.rpcUrl, config.networkPassphrase, config.contractId]);

  return (
    <bcForgeContext.Provider value={{ client }}>
      {children}
    </bcForgeContext.Provider>
  );
};

export const useBcForgeClient = () => {
  const context = useContext(bcForgeContext);
  if (!context.client) {
    throw new Error('useBcForgeClient must be used within a BcForgeProvider');
  }
  return context.client;
};
