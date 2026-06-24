/**
 * @bc-forge/sdk — WrapperClient
 *
 * High-level TypeScript client for interacting with deployed bc-forge
 * wrapper contracts on the Stellar/Soroban network.
 *
 * The wrapper contract wraps any SEP-41 compliant token into a bc-forge
 * compatible token, enabling cross-contract interoperability.
 */

import { rpc, Contract, TransactionBuilder, Keypair, xdr } from '@stellar/stellar-sdk';

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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WrapperClientConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge wrapper contract ID */
  contractId: string;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class WrapperClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: rpc.Server;
  private contract: Contract;

  constructor(config: WrapperClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new rpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  /**
   * Get the wrapped token balance for an address.
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the total wrapped token supply.
   */
  async getTotalSupply(): Promise<bigint> {
    const result = await this.queryContract('supply', []);
    return BigInt(scValToNative(result));
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
    return BigInt(scValToNative(result));
  }

  /**
   * Get the contract version string.
   */
  async getVersion(): Promise<string> {
    const result = await this.queryContract('version', []);
    return scValToNative(result) as string;
  }

  // ─── Write Transactions ──────────────────────────────────────────────────

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
    return this.invokeContract(
      'wrap',
      [addressToScVal(caller), i128ToScVal(amount)],
      source,
    );
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
      [
        addressToScVal(from),
        addressToScVal(spender),
        i128ToScVal(amount),
        u32ToScVal(exp),
      ],
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

  // ─── Offline Transaction Builders ────────────────────────────────────────

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
  async simulate(method: string, args: xdr.ScVal[], sourcePublicKey: string): Promise<any> {
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
  async simulateWrap(caller: string, amount: bigint, sourcePublicKey: string): Promise<any> {
    return this.simulate(
      'wrap',
      [addressToScVal(caller), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Simulate an unwrap operation.
   */
  async simulateUnwrap(
    caller: string,
    wrappedAmount: bigint,
    sourcePublicKey: string,
  ): Promise<any> {
    return this.simulate(
      'unwrap',
      [addressToScVal(caller), i128ToScVal(wrappedAmount)],
      sourcePublicKey,
    );
  }

  /**
   * Get recent events for the wrapper contract.
   */
  async getEvents(startLedger?: number): Promise<any[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  private async withRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: any;
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

        if (rpc.Api.isSimulationError(simulated)) {
          throw new SimulationError(`Query failed: ${simulated.error}`, simulated.error);
        }

        if (!rpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
          throw new SimulationError('Query returned no result');
        }

        return simulated.result.retval;
      } catch (error: any) {
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

        if (response.status === rpc.Api.GetTransactionStatus.SUCCESS) {
          return {
            success: true,
            hash: (response as any).hash,
            returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
          };
        }

        return {
          success: false,
          hash: (response as any).hash,
        };
      } catch (error: any) {
        if (error instanceof SimulationError) throw error;
        throw error;
      }
    });
  }
}
