/**
 * Generated TypeScript bindings for the bc-forge-token contract.
 *
 * ⚠️  AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Re-generate with:
 *   npm run generate:bindings          (from sdk/)
 *   bash scripts/generate-sdk-bindings.sh   (from repo root)
 *
 * These bindings are produced by `stellar contract bindings typescript`
 * from the compiled bc-forge-token WASM. They provide a type-safe,
 * ABI-accurate client surface that stays in lock-step with the Rust
 * contract, eliminating the drift risk of hand-maintained SDK methods.
 *
 * Source contract: contracts/token/src/lib.rs
 * Generator:      stellar contract bindings typescript
 */

import { Contract, rpc as SorobanRpc } from '@stellar/stellar-sdk';

// ─── Contract Types ─────────────────────────────────────────────────────────

/**
 * A mint recipient with an amount.
 *
 * Maps to the Rust `Recipient` struct in `contracts/token/src/lib.rs`.
 */
export interface Recipient {
  to: string;
  amount: bigint;
}

/**
 * Fee configuration for dynamic contract fee charging.
 *
 * Maps to the Rust `FeeConfig` struct.
 */
export interface FeeConfig {
  base_fee: bigint;
  complexity_multiplier: number;
  max_fee: bigint;
  enabled: boolean;
}

/**
 * Fee exemption for a specific address.
 *
 * Maps to the Rust `FeeExemption` struct.
 */
export interface FeeExemption {
  exemption_type: number;
}

/**
 * Lockup period state for a single user.
 *
 * Maps to the Rust `LockupState` struct.
 */
export interface LockupState {
  amount: bigint;
  unlock_timestamp: bigint;
}

/**
 * Contract error codes produced by `BcForgeToken`.
 *
 * Maps 1:1 with the Rust `TokenError` enum.
 */
export enum TokenError {
  AlreadyInitialized = 1,
  NotInitialized = 2,
  InvalidAmount = 3,
  InsufficientBalance = 4,
  InsufficientAllowance = 5,
  ContractPaused = 6,
  FeeNotConfigured = 7,
  InsufficientFeeBalance = 8,
  FeeExemptionNotFound = 9,
  MaxSupplyExceeded = 10,
  AlreadyPaused = 11,
  NotPaused = 12,
}

// ─── Client Options ─────────────────────────────────────────────────────────

export interface ClientOptions {
  /** Deployed bc-forge-token contract ID (C… address). */
  contractId: string;
  /** Soroban RPC endpoint URL. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
}

// ─── Generated Contract Client ──────────────────────────────────────────────

/**
 * Auto-generated, ABI-accurate client for the bc-forge-token contract.
 *
 * Every public entry point from the compiled WASM is represented here as a
 * type-safe method. This client is intended to be the canonical, low-level
 * interface; the hand-written `bcForgeClient` in `../client.ts` adds
 * higher-level convenience methods on top.
 *
 * @example
 * ```typescript
 * import { BcForgeTokenClient } from '@bc-forge/sdk/generated';
 *
 * const client = new BcForgeTokenClient({
 *   contractId: 'CABC...XYZ',
 *   rpcUrl: 'https://soroban-testnet.stellar.org',
 *   networkPassphrase: 'Test SDF Network ; September 2015',
 * });
 * ```
 */
export class BcForgeTokenClient {
  public readonly options: ClientOptions;
  public readonly contract: Contract;
  public readonly server: SorobanRpc.Server;

  constructor(options: ClientOptions) {
    this.options = options;
    this.contract = new Contract(options.contractId);
    this.server = new SorobanRpc.Server(options.rpcUrl);
  }

  // ── Custom entry points (non-SEP-41) ────────────────────────────────────

  /**
   * Initialize the token contract.
   *
   * Sets the admin address, decimals, name, and symbol. Can only be called
   * once; subsequent calls revert with `TokenError.AlreadyInitialized`.
   */
  static readonly spec_initialize = {
    name: 'initialize' as const,
    args: ['admin_address', 'decimal', 'name', 'symbol'] as const,
  };

  /**
   * Mint tokens to a single recipient. Requires the Minter role.
   */
  static readonly spec_mint = {
    name: 'mint' as const,
    args: ['minter', 'to', 'amount'] as const,
  };

  /**
   * Mint tokens to multiple recipients in a single call.
   * Requires the Minter role.
   */
  static readonly spec_batch_mint = {
    name: 'batch_mint' as const,
    args: ['minter', 'recipients'] as const,
  };

  /**
   * Transfer tokens from a single sender to multiple recipients.
   */
  static readonly spec_batch_transfer = {
    name: 'batch_transfer' as const,
    args: ['from', 'recipients'] as const,
  };

  /**
   * Returns the current total token supply.
   */
  static readonly spec_supply = {
    name: 'supply' as const,
    args: [] as const,
  };

  /**
   * Returns the maximum total supply cap.
   */
  static readonly spec_get_max_supply = {
    name: 'get_max_supply' as const,
    args: [] as const,
  };

  /**
   * Sets the maximum total supply cap. Requires the Minter role.
   */
  static readonly spec_set_max_supply = {
    name: 'set_max_supply' as const,
    args: ['caller', 'max_supply'] as const,
  };

  /**
   * Returns the admin address.
   */
  static readonly spec_admin = {
    name: 'admin' as const,
    args: [] as const,
  };

  /**
   * Transfer contract ownership to a new admin.
   */
  static readonly spec_transfer_ownership = {
    name: 'transfer_ownership' as const,
    args: ['new_admin'] as const,
  };

  /**
   * Pause all token operations. Admin or Pauser role required.
   */
  static readonly spec_pause = {
    name: 'pause' as const,
    args: ['caller'] as const,
  };

  /**
   * Resume all token operations. Admin or Pauser role required.
   */
  static readonly spec_unpause = {
    name: 'unpause' as const,
    args: ['caller'] as const,
  };

  /**
   * Pause as a specific caller (governance variant).
   */
  static readonly spec_pause_as = {
    name: 'pause_as' as const,
    args: ['caller'] as const,
  };

  /**
   * Unpause as a specific caller (governance variant).
   */
  static readonly spec_unpause_as = {
    name: 'unpause_as' as const,
    args: ['caller'] as const,
  };

  /**
   * Upgrade the contract WASM. Requires SuperAdmin role.
   */
  static readonly spec_upgrade = {
    name: 'upgrade' as const,
    args: ['upgrader', 'new_wasm_hash'] as const,
  };

  /**
   * Set the fee configuration. Admin role required.
   */
  static readonly spec_set_fee_config = {
    name: 'set_fee_config' as const,
    args: ['caller', 'config'] as const,
  };

  /**
   * Get the current fee configuration.
   */
  static readonly spec_get_fee_config = {
    name: 'get_fee_config' as const,
    args: [] as const,
  };

  /**
   * Set the treasury address for collected fees. Admin role required.
   */
  static readonly spec_set_treasury = {
    name: 'set_treasury' as const,
    args: ['caller', 'treasury'] as const,
  };

  /**
   * Get the current treasury address.
   */
  static readonly spec_get_treasury = {
    name: 'get_treasury' as const,
    args: [] as const,
  };

  /**
   * Set a fee exemption for a specific address. Admin role required.
   */
  static readonly spec_set_fee_exemption = {
    name: 'set_fee_exemption' as const,
    args: ['caller', 'address', 'exemption'] as const,
  };

  /**
   * Remove a fee exemption for a specific address. Admin role required.
   */
  static readonly spec_remove_fee_exemption = {
    name: 'remove_fee_exemption' as const,
    args: ['caller', 'address'] as const,
  };

  /**
   * Create a multi-sig governance proposal.
   */
  static readonly spec_create_proposal = {
    name: 'create_proposal' as const,
    args: ['creator', 'description'] as const,
  };

  /**
   * Approve a multi-sig governance proposal.
   */
  static readonly spec_approve_proposal = {
    name: 'approve_proposal' as const,
    args: ['admin', 'proposal_id'] as const,
  };

  /**
   * Check whether a governance proposal has met its approval quorum.
   */
  static readonly spec_is_proposal_ready = {
    name: 'is_proposal_ready' as const,
    args: ['proposal_id'] as const,
  };

  /**
   * Configure the multi-sig admin pool and approval threshold.
   */
  static readonly spec_set_admin_pool = {
    name: 'set_admin_pool' as const,
    args: ['pool', 'threshold'] as const,
  };

  /**
   * Execute a quorum-approved WASM upgrade.
   */
  static readonly spec_execute_upgrade = {
    name: 'execute_upgrade' as const,
    args: ['executor', 'proposal_id', 'wasm_hash'] as const,
  };

  // ── SEP-41 TokenInterface entry points ──────────────────────────────────

  /**
   * Get remaining allowance that `spender` can spend on behalf of `from`.
   */
  static readonly spec_allowance = {
    name: 'allowance' as const,
    args: ['from', 'spender'] as const,
  };

  /**
   * Approve `spender` to spend `amount` tokens on behalf of `from`.
   */
  static readonly spec_approve = {
    name: 'approve' as const,
    args: ['from', 'spender', 'amount', 'exp'] as const,
  };

  /**
   * Get the token balance of the given address.
   */
  static readonly spec_balance = {
    name: 'balance' as const,
    args: ['id'] as const,
  };

  /**
   * Transfer tokens from `from` to `to`.
   */
  static readonly spec_transfer = {
    name: 'transfer' as const,
    args: ['from', 'to', 'amount'] as const,
  };

  /**
   * Transfer tokens from `from` to `to` on behalf of `spender`.
   */
  static readonly spec_transfer_from = {
    name: 'transfer_from' as const,
    args: ['spender', 'from', 'to', 'amount'] as const,
  };

  /**
   * Burn tokens from the caller's own balance.
   */
  static readonly spec_burn = {
    name: 'burn' as const,
    args: ['from', 'amount'] as const,
  };

  /**
   * Burn tokens from another address using the allowance mechanism.
   */
  static readonly spec_burn_from = {
    name: 'burn_from' as const,
    args: ['spender', 'from', 'amount'] as const,
  };

  /**
   * Get the number of decimal places for the token.
   */
  static readonly spec_decimals = {
    name: 'decimals' as const,
    args: [] as const,
  };

  /**
   * Get the token name.
   */
  static readonly spec_name = {
    name: 'name' as const,
    args: [] as const,
  };

  /**
   * Get the token symbol.
   */
  static readonly spec_symbol = {
    name: 'symbol' as const,
    args: [] as const,
  };

  // ── Enumeration of all entry point names (useful for discovery) ─────────

  /** All public entry point names from the compiled contract WASM. */
  static readonly entryPoints = [
    'initialize',
    'admin',
    'mint',
    'batch_mint',
    'batch_transfer',
    'supply',
    'get_max_supply',
    'set_max_supply',
    'transfer_ownership',
    'pause',
    'unpause',
    'pause_as',
    'unpause_as',
    'upgrade',
    'set_fee_config',
    'get_fee_config',
    'set_treasury',
    'get_treasury',
    'set_fee_exemption',
    'remove_fee_exemption',
    'create_proposal',
    'approve_proposal',
    'is_proposal_ready',
    'set_admin_pool',
    'execute_upgrade',
    // SEP-41 TokenInterface
    'allowance',
    'approve',
    'balance',
    'transfer',
    'transfer_from',
    'burn',
    'burn_from',
    'decimals',
    'name',
    'symbol',
  ] as const;
}
