// SPDX-License-Identifier: MIT
import React from 'react';
import {
  BcForgeProvider,
  WalletProvider,
  ThemeProvider,
  useTheme,
  ConnectWallet,
  MintScreen,
  TransferScreen,
  BurnScreen,
  RolesScreen,
  VaultsScreen,
} from '@bc-forge/react';
import { Nav } from './Nav';
import { useHashRoute } from './useHashRoute';

/**
 * Contract id and RPC URL come from import.meta.env.
 * See react/demo/README.md for the full list of env vars.
 */
const providerConfig = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  networkPassphrase:
    import.meta.env.VITE_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015',
  contractId: import.meta.env.VITE_CONTRACT_ID ?? 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
};

const ROUTES: Record<string, React.ReactNode> = {
  '': (
    <section data-testid="connect-control" className="space-y-4">
      <h2 className="text-title">Connect Control</h2>
      <ConnectWallet />
    </section>
  ),
  '#/mint': <MintScreen />,
  '#/transfer': (
    <TransferScreen
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
  '#/burn': (
    <BurnScreen
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
  '#/roles': <RolesScreen />,
  '#/vaults': (
    <VaultsScreen
      rpcUrl={providerConfig.rpcUrl}
      networkPassphrase={providerConfig.networkPassphrase}
      contractId={providerConfig.contractId}
      walletAddress={import.meta.env.VITE_WALLET_ADDRESS}
    />
  ),
};

/**
 * Light / dark switch driven by the shared {@link ThemeProvider} (#1141).
 *
 * The label is explicit about the *action* (`Switch to dark`) so it is not
 * ambiguous to read, and the `data-testid` keeps it addressable from the
 * Playwright suite.
 */
const ThemeToggle: React.FC = () => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      onClick={toggleTheme}
      className="rounded-glass border border-[var(--bc-border)] bg-[var(--bc-surface)] px-3 py-1.5 text-caption font-semibold text-[var(--bc-text)] hover:bg-[var(--bc-brand-primary-subtle)]"
    >
      Switch to {next}
    </button>
  );
};

/**
 * Demo shell.
 *
 * `ThemeProvider` is mounted outside `BcForgeProvider` on purpose: the colour
 * scheme is a presentation concern that must apply to the page itself (the
 * `<html>` class and the `--bc-*` custom properties the Tailwind layer in
 * `src/index.css` reads), and it must be available even if the chain
 * configuration is broken.
 */
export const App: React.FC = () => {
  const route = useHashRoute();
  const content = ROUTES[route] ?? ROUTES[''];

  return (
    <ThemeProvider defaultTheme="system">
      <BcForgeProvider config={providerConfig}>
        <WalletProvider>
          <div className="surface-gradient mx-auto min-h-screen max-w-[900px] px-6 py-6 font-sans text-[var(--bc-text)]">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-title">bc-forge React Demo</h1>
              <ThemeToggle />
            </header>
            <Nav />
            <hr className="my-4 border-[var(--bc-border)]" />
            <main data-testid="screen-container">{content}</main>
          </div>
        </WalletProvider>
      </BcForgeProvider>
    </ThemeProvider>
  );
};