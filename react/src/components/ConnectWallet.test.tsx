// SPDX-License-Identifier: MIT
import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BcForgeProvider, WalletProvider, truncatePublicKey } from "../context";
import { useWallet } from "../hooks";
import { ConnectWallet } from "./ConnectWallet";

const FREIGHTER_KEY =
  "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";
const ALBEDO_KEY = "GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ";

// Shared spy so assertions reach the adapter registered by the provider.
// (Jest allows factory references when the name starts with "mock".)
const mockSetWalletAdapter = jest.fn();

jest.mock("@bc-forge/sdk", () => {
  class MockFreighterAdapter {
    name = "freighter";
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey =
        "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFTGWEBUSAVCBCY42YOXT";
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  }
  class MockAlbedoAdapter {
    name = "albedo";
    connected = false;
    publicKey?: string;
    async connect() {
      this.publicKey = "GAVTHAJHFEHX4PZ7GR6O5V2DSJ6G6J4U5XQZ4XK7X5XQZ4XK7X5XQZ";
      this.connected = true;
    }
    async disconnect() {
      this.publicKey = undefined;
      this.connected = false;
    }
    async signTransaction(xdr: string) {
      return xdr;
    }
  }
  return {
    Role: {
      Admin: "Admin",
      SuperAdmin: "SuperAdmin",
      Minter: "Minter",
      Pauser: "Pauser",
    },
    bcForgeClient: jest.fn().mockImplementation(() => ({
      setWalletAdapter: mockSetWalletAdapter,
    })),
    FreighterAdapter: MockFreighterAdapter,
    AlbedoAdapter: MockAlbedoAdapter,
  };
});

const config = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CA123",
};

/** Probe that exposes useWallet() state for assertions. */
const WalletProbe: React.FC = () => {
  const { name, publicKey, connected } = useWallet();
  return (
    <div>
      <span data-testid="probe-name">{name ?? "none"}</span>
      <span data-testid="probe-pubkey">{publicKey ?? "none"}</span>
      <span data-testid="probe-connected">{String(connected)}</span>
    </div>
  );
};

const renderConnected = () =>
  render(
    <BcForgeProvider config={config}>
      <WalletProvider>
        <ConnectWallet />
        <WalletProbe />
      </WalletProvider>
    </BcForgeProvider>,
  );

describe("ConnectWallet", () => {
  beforeEach(() => {
    mockSetWalletAdapter.mockClear();
    // A successful connect persists the wallet so a reload can restore it
    // (#1172), and jsdom keeps one `localStorage` for the whole file. A session
    // left by an earlier test would be silently reconnected on mount and push
    // `setWalletAdapter` past the single-call assertions below.
    localStorage.clear();
  });

  it("calls client.setWalletAdapter with the Freighter adapter and exposes the public key", async () => {
    renderConnected();

    fireEvent.click(screen.getByTestId("connect-freighter"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    });

    expect(mockSetWalletAdapter).toHaveBeenCalledTimes(1);
    const [firstCall] = mockSetWalletAdapter.mock.calls;
    const adapter = firstCall?.[0];
    expect(adapter?.name).toBe("freighter");
    expect(adapter?.publicKey).toBe(FREIGHTER_KEY);

    expect(screen.getByTestId("probe-name")).toHaveTextContent("freighter");
    expect(screen.getByTestId("probe-pubkey")).toHaveTextContent(FREIGHTER_KEY);
    expect(screen.getByTestId("connected-wallet")).toHaveTextContent(
      truncatePublicKey(FREIGHTER_KEY),
    );
  });

  it("calls client.setWalletAdapter with the Albedo adapter and exposes the public key", async () => {
    renderConnected();

    fireEvent.click(screen.getByTestId("connect-albedo"));

    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    });

    expect(mockSetWalletAdapter).toHaveBeenCalledTimes(1);
    const [firstCall] = mockSetWalletAdapter.mock.calls;
    const adapter = firstCall?.[0];
    expect(adapter?.name).toBe("albedo");
    expect(adapter?.publicKey).toBe(ALBEDO_KEY);

    expect(screen.getByTestId("probe-name")).toHaveTextContent("albedo");
    expect(screen.getByTestId("probe-pubkey")).toHaveTextContent(ALBEDO_KEY);
  });

  it("disconnects and clears the client signer", async () => {
    renderConnected();

    fireEvent.click(screen.getByTestId("connect-freighter"));
    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    });

    expect(mockSetWalletAdapter).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByTestId("probe-pubkey")).toHaveTextContent("none");
  });

  it("displays prominent warning banner identifying expected vs actual network passphrases (#1175)", async () => {
    class MismatchedFreighterAdapter {
      name = "freighter";
      connected = false;
      publicKey?: string;
      networkPassphrase = "Public Global Stellar Network ; September 2015";
      async connect() {
        this.publicKey = FREIGHTER_KEY;
        this.connected = true;
      }
      async disconnect() {}
      async signTransaction(xdr: string) {
        return xdr;
      }
    }

    render(
      <BcForgeProvider config={config}>
        <WalletProvider
          adapterFactories={{
            freighter: () => new MismatchedFreighterAdapter() as any,
          }}
        >
          <ConnectWallet />
        </WalletProvider>
      </BcForgeProvider>,
    );

    fireEvent.click(screen.getByTestId("connect-freighter"));

    await waitFor(() => {
      expect(
        screen.getByTestId("network-mismatch-warning"),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("network-mismatch-warning")).toHaveTextContent(
      /Test SDF Network ; September 2015/,
    );
    expect(screen.getByTestId("network-mismatch-warning")).toHaveTextContent(
      /Public Global Stellar Network ; September 2015/,
    );
  });

  it("renders mobile wallet deep links when isMobile is true (#1491)", () => {
    const wcUri = "wc:example-topic@2?relay-protocol=irn&symKey=dummy";
    render(
      <BcForgeProvider config={config}>
        <WalletProvider>
          <ConnectWallet isMobile={true} wcUri={wcUri} />
        </WalletProvider>
      </BcForgeProvider>,
    );

    expect(screen.getByTestId("mobile-wallet-deep-links")).toBeInTheDocument();
    const stellarLink = screen.getByTestId("deep-link-stellar");
    const lobstrLink = screen.getByTestId("deep-link-lobstr");
    const xbullLink = screen.getByTestId("deep-link-xbull");

    expect(stellarLink).toBeInTheDocument();
    expect(stellarLink).toHaveAttribute(
      "href",
      expect.stringContaining("stellar://wc?uri="),
    );
    expect(lobstrLink).toBeInTheDocument();
    expect(lobstrLink).toHaveAttribute(
      "href",
      expect.stringContaining("lobstr://stellar.org/connect?uri="),
    );
    expect(xbullLink).toBeInTheDocument();
    expect(xbullLink).toHaveAttribute(
      "href",
      expect.stringContaining("xbull://wc?uri="),
    );
  });

  it("auto-reconnects on mount when session is persisted (#1491)", async () => {
    localStorage.setItem(
      "bc-forge:walletconnect-session",
      JSON.stringify({
        walletName: "freighter",
        publicKey: FREIGHTER_KEY,
        connectedAt: Date.now(),
      }),
    );

    renderConnected();

    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    });

    expect(mockSetWalletAdapter).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("probe-name")).toHaveTextContent("freighter");
  });

  it("clears persisted session when disconnected (#1491)", async () => {
    localStorage.setItem(
      "bc-forge:walletconnect-session",
      JSON.stringify({
        walletName: "freighter",
        publicKey: FREIGHTER_KEY,
        connectedAt: Date.now(),
      }),
    );

    renderConnected();

    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByRole("button", { name: /disconnect/i }));

    await waitFor(() => {
      expect(screen.getByTestId("probe-connected")).toHaveTextContent("false");
    });

    expect(localStorage.getItem("bc-forge:walletconnect-session")).toBeNull();
  });
});
