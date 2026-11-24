// SPDX-License-Identifier: MIT
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@bc-forge/sdk", () => ({}));
jest.mock("../context", () => ({
  useNetwork: jest.fn(),
  useWallet: jest.fn(),
}));

import { useNetwork, useWallet, type NetworkId } from "../context";
import {
  NetworkSelector,
  NETWORK_SELECTOR_MISMATCH_MESSAGE,
} from "./NetworkSelector";

const networks = [
  {
    id: "testnet",
    label: "Testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    defaultRpcUrl: "https://soroban-testnet.stellar.org",
  },
  {
    id: "futurenet",
    label: "Futurenet",
    networkPassphrase: "Test SDF Future Network ; October 2022",
    defaultRpcUrl: "https://soroban-futurenet.stellar.org",
  },
  {
    id: "mainnet",
    label: "Mainnet",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    defaultRpcUrl: "https://soroban-rpc.mainnet.stellar.org",
  },
  {
    id: "local",
    label: "Local standalone",
    networkPassphrase: "Local Sandbox Stellar Network ; September 2022",
    defaultRpcUrl: "http://localhost:8000",
  },
] as const;

const mockSetNetwork = jest.fn<Promise<void>, [NetworkId]>();
const mockUseNetwork = useNetwork as unknown as jest.Mock;
const mockUseWallet = useWallet as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseNetwork.mockReturnValue({
    networkId: "testnet",
    networks,
    setNetwork: mockSetNetwork,
    isSwitching: false,
    error: null,
  });
  mockUseWallet.mockReturnValue({
    status: "connected",
    connected: true,
    error: null,
  });
});

describe("NetworkSelector (#1497)", () => {
  it("offers every configured network and marks the active one", () => {
    render(<NetworkSelector label="Network" />);

    expect(screen.getByTestId("network-selector")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /testnet/i }));

    const options = screen.getAllByRole("menuitem");
    expect(options).toHaveLength(4);
    expect(options.map((option) => option.textContent)).toEqual([
      "Testnet",
      "Futurenet",
      "Mainnet",
      "Local standalone",
    ]);
  });

  it("reconfigures the SDK client through setNetwork when a network is chosen", () => {
    const onNetworkChange = jest.fn();
    render(<NetworkSelector onNetworkChange={onNetworkChange} />);

    fireEvent.click(screen.getByRole("button", { name: /testnet/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Futurenet" }));

    expect(mockSetNetwork).toHaveBeenCalledWith("futurenet");
    expect(onNetworkChange).toHaveBeenCalledWith("futurenet");
  });

  it("warns when the connected wallet is on a different network", () => {
    mockUseWallet.mockReturnValue({
      status: "wrong-network",
      connected: false,
      error: new Error("Wallet is on a different Stellar network"),
    });

    render(<NetworkSelector />);

    expect(screen.getByTestId("network-mismatch-warning")).toHaveTextContent(
      "Wallet is on a different Stellar network",
    );
  });

  it("disables the dropdown and reports a failed switch", () => {
    mockUseNetwork.mockReturnValue({
      networkId: "testnet",
      networks,
      setNetwork: mockSetNetwork,
      isSwitching: true,
      error: new Error("switch failed"),
    });

    render(<NetworkSelector />);

    expect(screen.getByRole("button", { name: /testnet/i })).toBeDisabled();
    expect(screen.getByTestId("network-switch-error")).toHaveTextContent(
      "switch failed",
    );
  });

  it("renders a neutral placeholder when the provider has no active network", () => {
    mockUseNetwork.mockReturnValue({
      networkId: null,
      networks: [],
      setNetwork: mockSetNetwork,
      isSwitching: false,
      error: null,
    });
    mockUseWallet.mockReturnValue({
      status: "disconnected",
      connected: false,
      error: null,
    });

    render(<NetworkSelector />);

    expect(
      screen.getByRole("button", { name: /select network/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(NETWORK_SELECTOR_MISMATCH_MESSAGE).toContain(
      "different Stellar network",
    );
  });
});
