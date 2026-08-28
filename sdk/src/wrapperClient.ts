/**
 * @bc-forge/sdk â€” WrapperClient
 *
 * High-level TypeScript client for interacting with deployed bc-forge
 * wrapper contracts on the Stellar/Soroban network.
 *
 * The wrapper contract wraps any SEP-41 compliant token into a bc-forge
 * compatible token, enabling cross-contract interoperability.
 */

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';

import {
  buildInvokeTransaction,
  submitTransaction,
  addressToScVal,
  i128ToScVal,
  stringToScVal,
  u32ToScVal,
  scValToNative,
  buildUnsignedTransaction,
  signTransaction,
  simulateTransaction,
} from './utils';

import { SimulationError, RPCError } from './errors';
import type { TransactionResult } from './client';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WrapperClientConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge wrapper contract ID */
  contractId: string;
}

/**
 * Vault configuration parameters, limits, exchange rate, and fee state.
 */
export interface VaultState {
  /** Fee rate in basis points (e.g. 100 = 1%) */
  feeRateBps: number;
  /** Address designated to receive collected vault fees */
  feeReceiver: string;
  /** Minimum deposit limit per operation */
  minDeposit: bigint;
  /** Maximum deposit cap per operation or total vault capacity */
  maxDeposit: bigint;
  /** Current exchange rate between shares and underlying asset */
  exchangeRate: bigint;
  /** Accumulated undistributed fees */
  accumulatedFees: bigint;
  /** Timestamp of the last fee accumulation or rate update */
  lastUpdateTimestamp: bigint;
}

// â”€â”€â”€ Client â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class WrapperClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;

  constructor(config: WrapperClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
  }

  // â”€â”€â”€ Read-Only Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Get the wrapped token balance for an address.
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the total wrapped token supply.
   */
  async getTotalSupply(): Promise<bigint> {
    const result = await this.queryContract('supply', []);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the total underlying token assets held by the vault contract.
   */
  async getTotalAssets(): Promise<bigint> {
    const result = await this.queryContract('total_assets', []);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the current vault configuration parameters, limits, exchange rate, and fee state.
   */
  async getVaultState(): Promise<VaultState> {
    const result = await this.queryContract('get_vault_state', []);
    const native = scValToNative(result) as {
      accumulated_fees: bigint | number | string;
      exchange_rate: bigint | number | string;
      fee_rate_bps: number;
      fee_receiver: string;
      last_update_timestamp: bigint | number | string;
      max_deposit: bigint | number | string;
      min_deposit: bigint | number | string;
    };
    return {
      feeRateBps: Number(native.fee_rate_bps),
      feeReceiver: native.fee_receiver,
      minDeposit: BigInt(native.min_deposit),
      maxDeposit: BigInt(native.max_deposit),
      exchangeRate: BigInt(native.exchange_rate),
      accumulatedFees: BigInt(native.accumulated_fees),
      lastUpdateTimestamp: BigInt(native.last_update_timestamp),
    };
  }

  /**
   * Get the underlying SEP-41 token contract address being wrapped.
   */
  async getUnderlyingToken(): Promise<string> {
    const result = await this.queryContract('underlying_token', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the human-readable wrapper token name.
   */
  async getName(): Promise<string> {
    const result = await this.queryContract('name', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the wrapper token ticker symbol.
   */
  async getSymbol(): Promise<string> {
    const result = await this.queryContract('symbol', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the number of decimal places for the wrapper token.
   */
  async getDecimals(): Promise<number> {
    const result = await this.queryContract('decimals', []);
    return scValToNative(result) as number;
  }

  /**
   * Get the spending allowance from `owner` to `spender`.
   */
  async getAllowance(owner: string, spender: string): Promise<bigint> {
    const result = await this.queryContract('allowance', [
      addressToScVal(owner),
      addressToScVal(spender),
    ]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the contract version string.
   */
  async getVersion(): Promise<string> {
    const result = await this.queryContract('version', []);
    return scValToNative(result) as string;
  }

  // â”€â”€â”€ Write Transactions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Initialize the wrapper contract. Can only be called once.
   *
   * @param admin           - Admin address
   * @param tokenContractId - The SEP-41 token contract to wrap
   * @param decimal         - Decimal precision for the wrapper token
   * @param name            - Human-readable name (e.g. "Wrapped USDC")
   * @param symbol          - Ticker symbol (e.g. "wUSDC")
   * @param source          - Admin keypair
   */
  async initialize(
    admin: string,
    tokenContractId: string,
    decimal: number,
    name: string,
    symbol: string,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'initialize',
      [
        addressToScVal(admin),
        addressToScVal(tokenContractId),
        u32ToScVal(decimal),
        stringToScVal(name),
        stringToScVal(symbol),
      ],
      source,
    );
  }

  /**
   * Wrap `amount` of the underlying token.
   *
   * Transfers `amount` of the underlying token from `caller` into the wrapper
   * contract, then mints the equivalent wrapped tokens to `caller`. The caller
   * must have pre-approved the wrapper contract to spend `amount` of the
   * underlying token before calling this.
   *
   * @param caller - Address wrapping the tokens
   * @param amount - Amount of underlying tokens to wrap
   * @param source - Caller's keypair
   */
  async wrap(caller: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('wrap', [addressToScVal(caller), i128ToScVal(amount)], source);
  }

  /**
   * Unwrap `wrappedAmount` of wrapped tokens back to the underlying token.
   *
   * Burns `wrappedAmount` of wrapped tokens from `caller` and transfers the
   * equivalent underlying tokens back to `caller`.
   *
   * @param caller        - Address unwrapping the tokens
   * @param wrappedAmount - Amount of wrapped tokens to unwrap
   * @param source        - Caller's keypair
   */
  async unwrap(caller: string, wrappedAmount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'unwrap',
      [addressToScVal(caller), i128ToScVal(wrappedAmount)],
      source,
    );
  }

  /**
   * Distribute rewards into the vault/wrapper contract without issuing new shares.
   *
   * Transfers `amount` of the underlying token from `caller` into the vault contract,
   * increasing total underlying assets while keeping share supply constant.
   *
   * @param caller - Address providing the reward capital
   * @param amount - Amount of underlying tokens to distribute
   * @param source - Caller's keypair
   */
  async distributeRewards(
    caller: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'distribute_rewards',
      [addressToScVal(caller), i128ToScVal(amount)],
      source,
    );
  }

  /**
   * Configure vault parameters, limits, exchange rate, and fee state.
   *
   * @param caller - Admin caller address
   * @param state  - The complete VaultState configuration
   * @param source - Admin's keypair
   */
  async setVaultState(
    caller: string,
    state: VaultState,
    source: Keypair,
  ): Promise<TransactionResult> {
    const stateScVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('accumulated_fees'),
        val: i128ToScVal(state.accumulatedFees),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('exchange_rate'),
        val: i128ToScVal(state.exchangeRate),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('fee_rate_bps'),
        val: u32ToScVal(state.feeRateBps),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('fee_receiver'),
        val: addressToScVal(state.feeReceiver),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('last_update_timestamp'),
        val: xdr.ScVal.scvU64(new xdr.Uint64(state.lastUpdateTimestamp)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('max_deposit'),
        val: i128ToScVal(state.maxDeposit),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('min_deposit'),
        val: i128ToScVal(state.minDeposit),
      }),
    ]);

    return this.invokeContract(
      'set_vault_state',
      [addressToScVal(caller), stateScVal],
      source,
    );
  }

  /**
   * Get an address's vault share balance.
   *
   * A vault share is minted 1:1 with the wrapped token on `wrap()` and burned
   * 1:1 on `unwrap()`/`withdraw()`/`burn()`, so this returns the same value as
   * {@link getBalance} â€” exposed under vault vocabulary for callers reasoning
   * about shares rather than raw token units.
   */
  async getShareBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('share_balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the cumulative underlying tokens distributed via `distributeRewards`
   * that have not yet been compounded.
   *
   * This is a running total incremented on every `distributeRewards` call;
   * nothing on the contract consumes or resets it yet.
   */
  async getPendingRewards(): Promise<bigint> {
    const result = await this.queryContract('pending_rewards', []);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Calculate the current vault share price (total assets / total shares).
   *
   * The share price is the amount of underlying tokens each outstanding vault
   * share is entitled to. Throws when the contract reports an error, e.g. when
   * there are no outstanding shares yet (divide-by-zero protection).
   *
   * @returns Share price as bigint (integer division, rounded down)
   */
  async calculateSharePrice(): Promise<bigint> {
    const result = await this.queryContract('calculate_share_price', []);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Preview the pro-rata reward entitlement for a hypothetical share amount:
   * `rewards = (userShares * totalAssets) / totalShares`.
   *
   * This mirrors what `withdraw()` would pay out for `userShares` right now,
   * without burning shares or moving tokens. It is computed directly from the
   * totals rather than via `userShares * calculateSharePrice()`, which floors
   * twice and can under-report the entitlement â€” this floors only once, so it
   * always agrees with `withdraw()`'s actual payout.
   *
   * @param userShares - The hypothetical share amount to price out.
   * @returns The underlying token amount that many shares would be worth.
   */
  async calculateRewards(userShares: bigint): Promise<bigint> {
    const result = await this.queryContract('calculate_rewards', [i128ToScVal(userShares)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Withdraw `shares` of wrapped tokens and receive a proportional share of
   * the vault's underlying assets, including any accrued yield.
   *
   * Burns `shares` of wrapped tokens from `caller` and transfers the
   * proportional amount of underlying tokens back to `caller`.
   *
   * @param caller - Address withdrawing the shares
   * @param shares - Amount of wrapped shares to burn
   * @param source - Caller's keypair
   */
  async withdraw(caller: string, shares: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'withdraw',
      [addressToScVal(caller), i128ToScVal(shares)],
      source,
    );
  }

  /**
   * Enforce the deposit time lockup for a user.
   *
   * Records the timestamp (seconds since epoch) at which `user`'s deposit
   * becomes withdrawable. While the current ledger timestamp is before the
   * unlock time, `withdraw` reverts with `TokensLocked`. Admin-only.
   *
   * @param caller          - Admin address invoking the call
   * @param user            - Address whose deposit is being time-locked
   * @param unlockTimestamp - Unix timestamp (seconds) at which the deposit unlocks
   * @param source          - Caller's keypair
   */
  async setUnlockTime(
    caller: string,
    user: string,
    unlockTimestamp: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'set_unlock_time',
      [
        addressToScVal(caller),
        addressToScVal(user),
        nativeToScVal(unlockTimestamp, { type: 'u64' }),
      ],
      source,
    );
  }

  /**
   * Clear the deposit lockup for a user, immediately permitting withdrawals.
   * Admin-only.
   *
   * @param caller - Admin address invoking the call
   * @param user   - Address whose deposit lockup is being cleared
   * @param source - Caller's keypair
   */
  async clearUnlockTime(
    caller: string,
    user: string,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'clear_unlock_time',
      [addressToScVal(caller), addressToScVal(user)],
      source,
    );
  }

  /**
   * Get the timestamp at which a user's deposit becomes withdrawable.
   *
   * @param user - Address to query
   * @returns The unlock timestamp in seconds, or null when no lockup is recorded
   */
  async getUnlockTime(user: string): Promise<bigint | null> {
    const result = await this.queryContract('get_unlock_time', [addressToScVal(user)]);
    return scValToNative(result) as bigint | null;
  }

  /**
   * Transfer wrapped tokens between addresses.
   *
   * @param from   - Sender address
   * @param to     - Recipient address
   * @param amount - Number of wrapped tokens
   * @param source - Sender's keypair
   */
  async transfer(
    from: string,
    to: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
  }

  /**
   * Approve a spender to use wrapped tokens on your behalf.
   *
   * @param from    - Token owner
   * @param spender - Approved spender
   * @param amount  - Maximum spendable amount
   * @param exp     - Expiration ledger (0 for no expiration)
   * @param source  - Owner's keypair
   */
  async approve(
    from: string,
    spender: string,
    amount: bigint,
    exp: number,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'approve',
      [addressToScVal(from), addressToScVal(spender), i128ToScVal(amount), u32ToScVal(exp)],
      source,
    );
  }

  /**
   * Burn wrapped tokens from an address.
   *
   * @param from   - Address whose tokens to burn
   * @param amount - Number of wrapped tokens to burn
   * @param source - Burner's keypair
   */
  async burn(from: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('burn', [addressToScVal(from), i128ToScVal(amount)], source);
  }

  /**
   * Pause all wrap/unwrap and transfer operations. Admin-only.
   */
  async pause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('pause', [], source);
  }

  /**
   * Unpause operations. Admin-only.
   */
  async unpause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('unpause', [], source);
  }

  /**
   * Check if the wrapper contract is currently paused.
   *
   * @returns True if the contract is paused, false otherwise.
   */
  async isPaused(): Promise<boolean> {
    const result = await this.queryContract('is_paused', []);
    return scValToNative(result) as boolean;
  }

  // â”€â”€â”€ Offline Transaction Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Build an unsigned wrap transaction for offline signing.
   *
   * @param caller          - Address wrapping the tokens
   * @param amount          - Amount of underlying tokens to wrap
   * @param sourcePublicKey - Caller's public key
   * @returns Unsigned transaction XDR string
   */
  async buildWrapTx(caller: string, amount: bigint, sourcePublicKey: string): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'wrap',
      [addressToScVal(caller), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned unwrap transaction for offline signing.
   *
   * @param caller          - Address unwrapping the tokens
   * @param wrappedAmount   - Amount of wrapped tokens to unwrap
   * @param sourcePublicKey - Caller's public key
   * @returns Unsigned transaction XDR string
   */
  async buildUnwrapTx(
    caller: string,
    wrappedAmount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'unwrap',
      [addressToScVal(caller), i128ToScVal(wrappedAmount)],
      sourcePublicKey,
    );
  }

  /**
   * Sign an unsigned transaction XDR.
   */
  signTx(txXdr: string, keypair: Keypair): string {
    return signTransaction(txXdr, this.networkPassphrase, keypair);
  }

  /**
   * Simulate a contract invocation without submitting.
   */
  async simulate(method: string, args: xdr.ScVal[], sourcePublicKey: string): Promise<unknown> {
    return simulateTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      method,
      args,
      sourcePublicKey,
    );
  }

  /**
   * Simulate a wrap operation.
   */
  async simulateWrap(caller: string, amount: bigint, sourcePublicKey: string): Promise<unknown> {
    return this.simulate('wrap', [addressToScVal(caller), i128ToScVal(amount)], sourcePublicKey);
  }

  /**
   * Simulate an unwrap operation.
   */
  async simulateUnwrap(
    caller: string,
    wrappedAmount: bigint,
    sourcePublicKey: string,
  ): Promise<unknown> {
    return this.simulate(
      'unwrap',
      [addressToScVal(caller), i128ToScVal(wrappedAmount)],
      sourcePublicKey,
    );
  }

  /**
   * Get recent events for the wrapper contract.
   */
  async getEvents(startLedger?: number): Promise<unknown[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  // â”€â”€â”€ Internal Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async withRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    throw lastError;
  }

  private async queryContract(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal> {
    return this.withRetry(async () => {
      try {
        const account = new (await import('@stellar/stellar-sdk')).Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        );

        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(this.contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const simulated = await this.server.simulateTransaction(tx);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new SimulationError(`Query failed: ${simulated.error}`, simulated.error);
        }

        if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
          throw new SimulationError('Query returned no result');
        }

        return simulated.result.retval;
      } catch (error: unknown) {
        if (error instanceof SimulationError) throw error;
        throw new RPCError('RPC call failed', error);
      }
    });
  }

  private async invokeContract(
    method: string,
    args: xdr.ScVal[],
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.withRetry(async () => {
      try {
        const txXdr = await buildInvokeTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          source,
        );

        const response = await submitTransaction(this.rpcUrl, txXdr);

        if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          return {
            success: true,
            hash: response.txHash,
            returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
          };
        }

        return {
          success: false,
          hash: response.txHash,
        };
      } catch (error: unknown) {
        if (error instanceof SimulationError) throw error;
        throw error;
      }
    });
  }
}
