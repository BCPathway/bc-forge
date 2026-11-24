// SPDX-License-Identifier: MIT
import React from "react";
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
} from "@bc-forge/react";
import { Nav } from "./Nav";
import { useHashRoute } from "./useHashRoute";
import { loadConfig, type DemoConfig } from "./config";
import { ConfigErrorScreen } from "./ConfigErrorScreen";

/**
 * The environment is validated once at module load (#1146). Every screen reads
 * the same result, so an invalid `.env` can never leave the demo half-configured.
 */
const configResult = loadConfig();

/** Screens of the hash-routed demo, built from the validated configuration. */
function buildRoutes(config: DemoConfig): Record<string, React.ReactNode> {
  return {
    "": (
      <section data-testid="connect-control">
        <h2>Connect Control</h2>
        <ConnectWallet />
      </section>
    ),
    "#/mint": <MintScreen />,
    "#/transfer": <TransferScreen walletAddress={config.walletAddress} />,
    "#/burn": <BurnScreen walletAddress={config.walletAddress} />,
    "#/roles": <RolesScreen />,
    "#/vaults": (
      <VaultsScreen
        rpcUrl={config.rpcUrl}
        networkPassphrase={config.networkPassphrase}
        contractId={config.contractId}
      />
    ),
  };
}

/**
 * Light / dark switch driven by the shared {@link ThemeProvider} (#1141).
 *
 * The label is explicit about the *action* (`Switch to dark`) so it is not
 * ambiguous to read, and the `data-testid` keeps it addressable from the
 * Playwright suite.
 */
const ThemeToggle: React.FC = () => {
  const { resolvedTheme, toggleTheme } = useTheme();
  const next = resolvedTheme === "dark" ? "light" : "dark";

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

  // Hooks must run on every render, so the environment check happens after them.
  if (!configResult.ok) {
    return <ConfigErrorScreen issues={configResult.issues} />;
  }

  const { config } = configResult;
  const routes = buildRoutes(config);
  const content = routes[route] ?? routes[""];

  return (
    <BcForgeProvider
      config={{
        rpcUrl: config.rpcUrl,
        networkPassphrase: config.networkPassphrase,
        contractId: config.contractId,
      }}
    >
      <WalletProvider>
        <div
          style={{
            fontFamily: "sans-serif",
            maxWidth: 900,
            margin: "0 auto",
            padding: 24,
          }}
        >
          <h1>bc-forge React Demo</h1>
          <Nav />
          <hr />
          <main data-testid="screen-container">{content}</main>
        </div>
      </WalletProvider>
    </BcForgeProvider>
  );
};
