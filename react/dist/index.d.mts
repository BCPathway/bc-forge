import React, { ReactNode } from 'react';
import * as _bc_forge_sdk from '@bc-forge/sdk';
import { bcForgeClientConfig, bcForgeClient } from '@bc-forge/sdk';
import { Keypair } from '@stellar/stellar-sdk';

interface BcForgeProviderProps {
    config: bcForgeClientConfig;
    children: ReactNode;
}
declare const BcForgeProvider: React.FC<BcForgeProviderProps>;
declare const useBcForgeClient: () => bcForgeClient;

/**
 * Hook to fetch basic token information (name, symbol, decimals).
 */
declare function useBcForgeToken(): {
    data: {
        name: string;
        symbol: string;
        decimals: number;
    } | null;
    loading: boolean;
    error: Error | null;
};
/**
 * Hook to fetch the balance of a specific address.
 */
declare function useBalance(address: string | undefined): {
    data: bigint | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * Hook to perform mint operations.
 */
declare function useMint(): {
    mint: (to: string, amount: bigint, source: Keypair) => Promise<_bc_forge_sdk.TransactionResult>;
    loading: boolean;
    error: Error | null;
};
/**
 * Hook to fetch the total supply of the token.
 */
declare function useTotalSupply(): {
    data: bigint | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};
/**
 * Hook to perform transfer operations.
 */
declare function useTransfer(): {
    transfer: (from: string, to: string, amount: bigint, source: Keypair) => Promise<_bc_forge_sdk.TransactionResult>;
    loading: boolean;
    error: Error | null;
};
/**
 * Hook to perform approve operations.
 */
declare function useApprove(): {
    approve: (from: string, spender: string, amount: bigint, source: Keypair) => Promise<_bc_forge_sdk.TransactionResult>;
    loading: boolean;
    error: Error | null;
};
/**
 * Hook to perform burn operations.
 */
declare function useBurn(): {
    burn: (from: string, amount: bigint, source: Keypair) => Promise<_bc_forge_sdk.TransactionResult>;
    loading: boolean;
    error: Error | null;
};
/**
 * Hook to fetch the allowance between owner and spender.
 */
declare function useAllowance(owner: string | undefined, spender: string | undefined): {
    data: bigint | null;
    loading: boolean;
    error: Error | null;
    refetch: () => Promise<void>;
};

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';
interface AlertProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    /** Visual + semantic style of the alert. @default 'info' */
    variant?: AlertVariant;
    /** Optional bold title rendered above the content. */
    title?: React.ReactNode;
    /** When provided, renders a dismiss button that calls this handler. */
    onDismiss?: () => void;
    /** Accessible label for the dismiss button. @default 'Dismiss alert' */
    dismissLabel?: string;
}
/** Alert banner; role is "alert" for danger/warning and "status" otherwise. */
declare const Alert: React.ForwardRefExoticComponent<AlertProps & React.RefAttributes<HTMLDivElement>>;

type BadgeVariant = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info';
type BadgeSize = 'sm' | 'md' | 'lg';
interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    /** Visual variant of the badge. @default 'default' */
    variant?: BadgeVariant;
    /** Size of the badge. @default 'md' */
    size?: BadgeSize;
}
/** Badge label. When `onClick` is provided the element becomes a
 * keyboard-focusable interactive control (role="button", tabIndex={0},
 * Enter/Space activation). Pass explicit `role` or `tabIndex` to override. */
declare const Badge: React.ForwardRefExoticComponent<BadgeProps & React.RefAttributes<HTMLSpanElement>>;

type DropdownVariant = 'default' | 'primary' | 'danger';
type DropdownSize = 'sm' | 'md' | 'lg';
interface DropdownItem {
    label: string;
    value: string;
    disabled?: boolean;
}
interface DropdownProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
    /** Array of menu items to display. */
    items: DropdownItem[];
    /** Controlled selected value. */
    value?: string;
    /** Initial selected value (uncontrolled). */
    defaultValue?: string;
    /** Called when an item is selected. */
    onChange?: (item: DropdownItem) => void;
    /** Visual style variant. @default 'default' */
    variant?: DropdownVariant;
    /** Size. @default 'md' */
    size?: DropdownSize;
    /** Placeholder when no item is selected. @default 'Select...' */
    placeholder?: string;
    /** Disables the entire dropdown. */
    disabled?: boolean;
}
/** Reusable dropdown menu with full keyboard navigation and ARIA support. */
declare const Dropdown: React.ForwardRefExoticComponent<DropdownProps & React.RefAttributes<HTMLDivElement>>;

export { Alert, type AlertProps, type AlertVariant, Badge, type BadgeProps, type BadgeSize, type BadgeVariant, BcForgeProvider, type BcForgeProviderProps, Dropdown, type DropdownItem, type DropdownProps, type DropdownSize, type DropdownVariant, useAllowance, useApprove, useBalance, useBcForgeClient, useBcForgeToken, useBurn, useMint, useTotalSupply, useTransfer };
