/**
 * @bc-forge/sdk — VaultClient
 *
 * High-level TypeScript client for interacting with deployed bc-forge
 * yield-bearing fee vault and wrapper contracts on the Stellar/Soroban network.
 */

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import type { WalletAdapter } from './walletAdapter';

import {
  buildInvokeTransaction,
  submitTransaction,
  addressToScVal,
  i128ToScVal,
  u32ToScVal,
  scValToNative,
  buildUnsignedTransaction,
  signTransaction,
  simulateTransaction,
} from './utils';

import { SimulationError, RPCError } from './errors';
import type { TransactionResult } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VaultClientConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge vault contract ID */
  contractId: string;
  /** Optional wallet adapter for browser-based signing flows */
  walletAdapter?: WalletAdapter;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class VaultClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;
  private walletAdapter?: WalletAdapter;

  constructor(config: VaultClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
    this.walletAdapter = config.walletAdapter;
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  /**
   * Get the vault share balance for an address.
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get an address's vault share balance under vault vocabulary.
   */
  async getShareBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('share_balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the total vault share supply in circulation.
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
   * Get the cumulative pending/undistributed fees/rewards.
   */
  async getPendingRewards(): Promise<bigint> {
    const result = await this.queryContract('pending_rewards', []);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Calculate the current vault share price (total assets / total shares).
   */
  async calculateSharePrice(): Promise<bigint> {
    const result = await this.queryContract('calculate_share_price', []);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Calculate the pro-rata reward/underlying token entitlement for a given amount of shares.
   */
  async calculateRewards(userShares: bigint): Promise<bigint> {
    const result = await this.queryContract('calculate_rewards', [i128ToScVal(userShares)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the underlying token contract address.
   */
  async getUnderlyingToken(): Promise<string> {
    const result = await this.queryContract('underlying_token', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the human-readable vault share token name.
   */
  async getName(): Promise<string> {
    const result = await this.queryContract('name', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the vault share token ticker symbol.
   */
  async getSymbol(): Promise<string> {
    const result = await this.queryContract('symbol', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the number of decimal places for the vault.
   */
  async getDecimals(): Promise<number> {
    const result = await this.queryContract('decimals', []);
    return scValToNative(result) as number;
  }

  /**
   * Get spending allowance from owner to spender.
   */
  async getAllowance(owner: string, spender: string): Promise<bigint> {
    const result = await this.queryContract('allowance', [
      addressToScVal(owner),
      addressToScVal(spender),
    ]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the deposit lockup expiration timestamp for a user.
   */
  async getUnlockTime(user: string): Promise<bigint | null> {
    const result = await this.queryContract('get_unlock_time', [addressToScVal(user)]);
    return scValToNative(result) as bigint | null;
  }

  // ─── Write Transactions ──────────────────────────────────────────────────

  /**
   * Deposit underlying tokens into the vault and receive minted vault shares.
   *
   * @param caller       - Depositor address
   * @param amount       - Amount of underlying tokens to deposit
   * @param source       - Depositor keypair (or signer)
   * @param minSharesOut - Optional minimum shares to receive (slippage protection)
   */
  async deposit(
    caller: string,
    amount: bigint,
    source: Keypair,
    minSharesOut?: bigint,
  ): Promise<TransactionResult> {
    const args =
      minSharesOut !== undefined
        ? [addressToScVal(caller), i128ToScVal(amount), i128ToScVal(minSharesOut)]
        : [addressToScVal(caller), i128ToScVal(amount)];
    return this.invokeContract('deposit', args, source);
  }

  /**
   * Withdraw vault shares and receive proportional underlying tokens plus accrued yield.
   *
   * @param caller       - Withdrawer address
   * @param shares       - Amount of vault shares to burn
   * @param source       - Withdrawer keypair (or signer)
   * @param minTokensOut - Optional minimum tokens to receive (slippage protection)
   */
  async withdraw(
    caller: string,
    shares: bigint,
    source: Keypair,
    minTokensOut?: bigint,
  ): Promise<TransactionResult> {
    const args =
      minTokensOut !== undefined
        ? [addressToScVal(caller), i128ToScVal(shares), i128ToScVal(minTokensOut)]
        : [addressToScVal(caller), i128ToScVal(shares)];
    return this.invokeContract('withdraw', args, source);
  }

  /**
   * Compound pending protocol fees into the vault's total assets.
   *
   * @param caller - Address executing the compound operation
   * @param source - Caller's keypair
   */
  async compound(caller: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('compound_fees', [addressToScVal(caller)], source);
  }

  /**
   * Compound pending fees alias for compound_fees.
   */
  async compoundFees(caller: string, source: Keypair): Promise<TransactionResult> {
    return this.compound(caller, source);
  }

  /**
   * Distribute rewards into the vault without issuing new shares.
   *
   * @param caller - Reward provider address
   * @param amount - Amount of underlying tokens to distribute
   * @param source - Caller keypair
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
   * Wrap underlying tokens into vault shares (1:1 standard wrapper entrypoint).
   */
  async wrap(caller: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('wrap', [addressToScVal(caller), i128ToScVal(amount)], source);
  }

  /**
   * Unwrap vault shares back to underlying tokens (1:1 standard wrapper exitpoint).
   */
  async unwrap(caller: string, wrappedAmount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'unwrap',
      [addressToScVal(caller), i128ToScVal(wrappedAmount)],
      source,
    );
  }

  /**
   * Set deposit time lockup for a user (admin operation).
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
   * Clear deposit time lockup for a user (admin operation).
   */
  async clearUnlockTime(caller: string, user: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'clear_unlock_time',
      [addressToScVal(caller), addressToScVal(user)],
      source,
    );
  }

  /**
   * Transfer vault shares between addresses.
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
   * Approve a spender for vault shares.
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
   * Transfer vault shares from an approved address.
   */
  async transferFrom(
    spender: string,
    from: string,
    to: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'transfer_from',
      [addressToScVal(spender), addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
  }

  // ─── Offline Transaction Building & Simulation ───────────────────────────

  /**
   * Build an unsigned transaction XDR for deposit.
   */
  async buildDepositTx(
    caller: string,
    amount: bigint,
    sourcePublicKey: string,
    minSharesOut?: bigint,
  ): Promise<string> {
    const args =
      minSharesOut !== undefined
        ? [addressToScVal(caller), i128ToScVal(amount), i128ToScVal(minSharesOut)]
        : [addressToScVal(caller), i128ToScVal(amount)];
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'deposit',
      args,
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned transaction XDR for withdraw.
   */
  async buildWithdrawTx(
    caller: string,
    shares: bigint,
    sourcePublicKey: string,
    minTokensOut?: bigint,
  ): Promise<string> {
    const args =
      minTokensOut !== undefined
        ? [addressToScVal(caller), i128ToScVal(shares), i128ToScVal(minTokensOut)]
        : [addressToScVal(caller), i128ToScVal(shares)];
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'withdraw',
      args,
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned transaction XDR for compounding fees.
   */
  async buildCompoundTx(caller: string, sourcePublicKey: string): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'compound_fees',
      [addressToScVal(caller)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned transaction XDR for distributing rewards.
   */
  async buildDistributeRewardsTx(
    caller: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'distribute_rewards',
      [addressToScVal(caller), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Sign an unsigned transaction XDR with a Keypair.
   */
  signTx(xdrString: string, signer: Keypair): string {
    return signTransaction(xdrString, this.networkPassphrase, signer);
  }

  /**
   * Simulate a contract call without submitting a transaction.
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
   * Simulate a deposit operation.
   */
  async simulateDeposit(
    caller: string,
    amount: bigint,
    sourcePublicKey: string,
    minSharesOut?: bigint,
  ): Promise<unknown> {
    const args =
      minSharesOut !== undefined
        ? [addressToScVal(caller), i128ToScVal(amount), i128ToScVal(minSharesOut)]
        : [addressToScVal(caller), i128ToScVal(amount)];
    return this.simulate('deposit', args, sourcePublicKey);
  }

  /**
   * Simulate a withdraw operation.
   */
  async simulateWithdraw(
    caller: string,
    shares: bigint,
    sourcePublicKey: string,
    minTokensOut?: bigint,
  ): Promise<unknown> {
    const args =
      minTokensOut !== undefined
        ? [addressToScVal(caller), i128ToScVal(shares), i128ToScVal(minTokensOut)]
        : [addressToScVal(caller), i128ToScVal(shares)];
    return this.simulate('withdraw', args, sourcePublicKey);
  }

  /**
   * Simulate a compound fees operation.
   */
  async simulateCompound(caller: string, sourcePublicKey: string): Promise<unknown> {
    return this.simulate('compound_fees', [addressToScVal(caller)], sourcePublicKey);
  }

  /**
   * Get recent events for the vault contract.
   */
  async getEvents(startLedger?: number): Promise<unknown[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

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
