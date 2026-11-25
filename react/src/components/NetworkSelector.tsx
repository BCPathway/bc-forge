// SPDX-License-Identifier: MIT
import React from "react";
import { Dropdown, type DropdownItem } from "./Dropdown";
import { useNetwork, useWallet, type NetworkId } from "../context";
import { theme } from "../theme";

/** Shown when the connected wallet and the dApp are on different networks (#1497). */
export const NETWORK_SELECTOR_MISMATCH_MESSAGE =
  "Your wallet is connected to a different Stellar network than this dApp. Switch your wallet to the selected network.";

export interface NetworkSelectorProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Optional label rendered above the control. */
  label?: string;
  /** Called after a new network is selected. */
  onNetworkChange?: (id: NetworkId) => void;
}

/**
 * Dropdown that switches the active Stellar network without editing dApp code.
 *
 * The control reads the networks exposed by {@link useNetwork}, so any custom
 * network configured on the provider is selectable. Switching calls
 * `setNetwork`, which rebuilds the SDK client and RPC endpoint. A connected
 * wallet on a different network is surfaced as a visible warning.
 */
export function NetworkSelector({
  label,
  className,
  style,
  onNetworkChange,
  ...rest
}: NetworkSelectorProps): React.ReactElement {
  const { networkId, networks, setNetwork, isSwitching, error } = useNetwork();
  const wallet = useWallet();

  const items: DropdownItem[] = networks.map((network) => ({
    label: network.label,
    value: network.id,
  }));
  const selected = networks.find((network) => network.id === networkId);

  const handleChange = (item: DropdownItem): void => {
    const id = item.value as NetworkId;
    void setNetwork(id);
    onNetworkChange?.(id);
  };

  return (
    <div
      {...rest}
      data-testid="network-selector"
      role="group"
      aria-label={label ?? "Stellar network"}
      className={className}
      style={style}
    >
      {label ? (
        <div
          style={{ marginBottom: 4, color: theme.neutralText, fontSize: 12 }}
        >
          {label}
        </div>
      ) : null}
      <Dropdown
        data-testid="network-selector-dropdown"
        aria-label="Stellar network"
        items={items}
        value={networkId ?? undefined}
        placeholder="Select network"
        onChange={handleChange}
        disabled={isSwitching}
      />
      {wallet.status === "wrong-network" ? (
        <div
          data-testid="network-mismatch-warning"
          role="alert"
          style={{
            marginTop: 6,
            padding: "6px 8px",
            border: `1px solid ${theme.warningBorder}`,
            borderRadius: 6,
            background: theme.warningBackground,
            color: theme.warningText,
            fontSize: 12,
          }}
        >
          {wallet.error?.message || NETWORK_SELECTOR_MISMATCH_MESSAGE}
        </div>
      ) : null}
      {error ? (
        <div
          data-testid="network-switch-error"
          role="alert"
          style={{
            marginTop: 6,
            padding: "6px 8px",
            border: `1px solid ${theme.dangerBorder}`,
            borderRadius: 6,
            background: theme.dangerBackground,
            color: theme.dangerText,
            fontSize: 12,
          }}
        >
          {error.message}
        </div>
      ) : null}
      {selected ? (
        <span data-testid="network-selector-active-passphrase" hidden>
          {selected.networkPassphrase}
        </span>
      ) : null}
    </div>
  );
}
