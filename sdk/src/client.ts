/**
 * @bc-forge/sdk — bcForgeClient
 *
 * High-level TypeScript client for interacting with deployed bc-forge
 * token contracts on the Stellar/Soroban network.
 */

import {
  SorobanRpc,
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
  hashToScVal,
} from './utils';

import { SimulationError, RPCError } from './errors';
import { CacheManager, CacheConfig, CacheMetrics, CacheWarmEntry } from './cache';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface bcForgeClientConfig {
  /** Soroban RPC endpoint URL (e.g., https://soroban-testnet.stellar.org) */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge token contract ID */
  contractId: string;
  /**
   * Enable in-memory caching for read-only queries.
   * Pass `{}` to use defaults (30 s TTL, 100-entry LRU).
   * Omit entirely to disable caching.
   */
  cacheConfig?: Partial<CacheConfig>;
}

export interface TransactionResult {
  /** Whether the transaction was successful */
  success: boolean;
  /** Transaction hash */
  hash: string;
  /** Return value from the contract (if any) */
  returnValue?: any;
}

export interface BatchMintRecipient {
  /** Recipient Stellar public key (G... address) */
  to: string;
  /** Number of tokens to mint */
  amount: bigint;
}

// ─── Cache key constants ──────────────────────────────────────────────────────

const CK = {
  balance: (addr: string) => `balance:${addr}`,
  supply: 'supply',
  name: 'name',
  symbol: 'symbol',
  decimals: 'decimals',
  allowance: (owner: string, spender: string) => `allowance:${owner}:${spender}`,
  version: 'version',
} as const;

// ─── Client ──────────────────────────────────────────────────────────────────

export class bcForgeClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;
  private cache: CacheManager | undefined;

  constructor(config: bcForgeClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
    if (config.cacheConfig !== undefined) {
      this.cache = new CacheManager(config.cacheConfig);
    }
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  async getBalance(address: string): Promise<bigint> {
    return this.cached(CK.balance(address), async () => {
      const result = await this.queryContract('balance', [addressToScVal(address)]);
      return BigInt(scValToNative(result));
    });
  }

  async getTotalSupply(): Promise<bigint> {
    return this.cached(CK.supply, async () => {
      const result = await this.queryContract('supply', []);
      return BigInt(scValToNative(result));
    });
  }

  async getName(): Promise<string> {
    return this.cached(CK.name, async () => {
      const result = await this.queryContract('name', []);
      return scValToNative(result) as string;
    });
  }

  async getSymbol(): Promise<string> {
    return this.cached(CK.symbol, async () => {
      const result = await this.queryContract('symbol', []);
      return scValToNative(result) as string;
    });
  }

  async getDecimals(): Promise<number> {
    return this.cached(CK.decimals, async () => {
      const result = await this.queryContract('decimals', []);
      return scValToNative(result) as number;
    });
  }

  async getAllowance(owner: string, spender: string): Promise<bigint> {
    return this.cached(CK.allowance(owner, spender), async () => {
      const result = await this.queryContract('allowance', [
        addressToScVal(owner),
        addressToScVal(spender),
      ]);
      return BigInt(scValToNative(result));
    });
  }

  async getVersion(): Promise<string> {
    return this.cached(CK.version, async () => {
      const result = await this.queryContract('version', []);
      return scValToNative(result) as string;
    });
  }

  // ─── Batch Queries ───────────────────────────────────────────────────────

  async getBalances(addresses: string[], batchSize: number = 10): Promise<bigint[]> {
    return this.executeBatch(addresses, (addr) => this.getBalance(addr), batchSize);
  }

  private async executeBatch<T, R>(
    items: T[],
    task: (item: T) => Promise<R>,
    batchSize: number,
  ): Promise<R[]> {
    const results: R[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const chunk = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(chunk.map((item) => task(item)));
      results.push(...batchResults);
    }
    return results;
  }

  // ─── Write Transactions ──────────────────────────────────────────────────

  async initialize(
    admin: string,
    decimals: number,
    name: string,
    symbol: string,
    source: Keypair,
  ): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'initialize',
      [addressToScVal(admin), u32ToScVal(decimals), stringToScVal(name), stringToScVal(symbol)],
      source,
    );
    if (result.success) this.cache?.invalidateAll();
    return result;
  }

  async mint(to: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'mint',
      [addressToScVal(to), i128ToScVal(amount)],
      source,
    );
    if (result.success) {
      this.cache?.invalidate(CK.balance(to));
      this.cache?.invalidate(CK.supply);
    }
    return result;
  }

  async batchMint(recipients: BatchMintRecipient[], source: Keypair): Promise<TransactionResult> {
    const recipientScVals = recipients.map(({ to, amount }) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('address'),
          val: addressToScVal(to),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: i128ToScVal(amount),
        }),
      ]),
    );
    const recipientsVec = xdr.ScVal.scvVec(recipientScVals);
    const result = await this.invokeContract('batch_mint', [recipientsVec], source);
    if (result.success) {
      this.cache?.invalidate(CK.supply);
      for (const { to } of recipients) {
        this.cache?.invalidate(CK.balance(to));
      }
    }
    return result;
  }

  async transfer(
    from: string,
    to: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
    if (result.success) {
      this.cache?.invalidate(CK.balance(from));
      this.cache?.invalidate(CK.balance(to));
    }
    return result;
  }

  async approve(
    from: string,
    spender: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'approve',
      [
        addressToScVal(from),
        addressToScVal(spender),
        i128ToScVal(amount),
        u32ToScVal(0), // expiration ledger
      ],
      source,
    );
    if (result.success) {
      this.cache?.invalidate(CK.allowance(from, spender));
    }
    return result;
  }

  async burn(from: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'burn',
      [addressToScVal(from), i128ToScVal(amount)],
      source,
    );
    if (result.success) {
      this.cache?.invalidate(CK.balance(from));
      this.cache?.invalidate(CK.supply);
    }
    return result;
  }

  async transferOwnership(newAdmin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('transfer_ownership', [addressToScVal(newAdmin)], source);
  }

  async pause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('pause', [], source);
  }

  async unpause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('unpause', [], source);
  }

  // ─── Offline Transaction Builders ──────────────────────────────────────────

  async buildMintTx(to: string, amount: bigint, sourcePublicKey: string): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'mint',
      [addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  async buildTransferTx(
    from: string,
    to: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  async buildApproveTx(
    from: string,
    spender: string,
    amount: bigint,
    exp: number,
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'approve',
      [addressToScVal(from), addressToScVal(spender), i128ToScVal(amount), u32ToScVal(exp)],
      sourcePublicKey,
    );
  }

  async buildBurnTx(from: string, amount: bigint, sourcePublicKey: string): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'burn',
      [addressToScVal(from), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  signTx(txXdr: string, keypair: Keypair): string {
    return signTransaction(txXdr, this.networkPassphrase, keypair);
  }

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

  async simulateMint(to: string, amount: bigint, sourcePublicKey: string): Promise<any> {
    return this.simulate('mint', [addressToScVal(to), i128ToScVal(amount)], sourcePublicKey);
  }

  async simulateTransfer(
    from: string,
    to: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<any> {
    return this.simulate(
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  // ─── Multi-Sig / Admin Pool ──────────────────────────────────────────────

  async setAdminPool(
    pool: string[],
    threshold: number,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'set_admin_pool',
      [
        nativeToScVal(
          pool.map((addr) => addressToScVal(addr)),
          { type: 'vec' },
        ),
        u32ToScVal(threshold),
      ],
      source,
    );
  }

  async upgrade(newWasmHash: string | Buffer, source: Keypair): Promise<TransactionResult> {
    const result = await this.invokeContract('upgrade', [hashToScVal(newWasmHash)], source);
    // Contract logic may change after upgrade; full invalidation is safest.
    if (result.success) this.cache?.invalidateAll();
    return result;
  }

  async proposeAction(
    admin: string,
    action: { Mint: [string, bigint] } | { Pause: [] } | { Unpause: [] },
    description: string,
    source: Keypair,
  ): Promise<TransactionResult> {
    const actionScVal =
      'Mint' in action
        ? nativeToScVal({
            Mint: [addressToScVal(action.Mint[0]), i128ToScVal(action.Mint[1])],
          })
        : nativeToScVal(action);

    return this.invokeContract(
      'propose_action',
      [addressToScVal(admin), actionScVal, stringToScVal(description)],
      source,
    );
  }

  async approveProposal(
    admin: string,
    proposalId: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'approve_proposal',
      [addressToScVal(admin), nativeToScVal(proposalId, { type: 'u64' })],
      source,
    );
  }

  async executeProposal(proposalId: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'execute_proposal',
      [nativeToScVal(proposalId, { type: 'u64' })],
      source,
    );
  }

  // ─── Clawback / Regulatory ───────────────────────────────────────────────

  async setClawbackAdmin(admin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('set_clawback_admin', [addressToScVal(admin)], source);
  }

  async updateName(newName: string, source: Keypair): Promise<TransactionResult> {
    const result = await this.invokeContract('update_name', [stringToScVal(newName)], source);
    if (result.success) this.cache?.invalidate(CK.name);
    return result;
  }

  async clawback(
    from: string,
    to: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'clawback',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
    if (result.success) {
      this.cache?.invalidate(CK.balance(from));
      this.cache?.invalidate(CK.balance(to));
    }
    return result;
  }

  // ─── Locking / Vesting ───────────────────────────────────────────────────

  async lockTokens(
    user: string,
    amount: bigint,
    unlockTime: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    const result = await this.invokeContract(
      'lock_tokens',
      [addressToScVal(user), i128ToScVal(amount), nativeToScVal(unlockTime, { type: 'u64' })],
      source,
    );
    if (result.success) this.cache?.invalidate(CK.balance(user));
    return result;
  }

  async withdrawLocked(user: string, source: Keypair): Promise<TransactionResult> {
    const result = await this.invokeContract('withdraw_locked', [addressToScVal(user)], source);
    if (result.success) this.cache?.invalidate(CK.balance(user));
    return result;
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  async getEvents(startLedger?: number): Promise<any[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  async updateSymbol(newSymbol: string, source: Keypair): Promise<TransactionResult> {
    const result = await this.invokeContract('update_symbol', [stringToScVal(newSymbol)], source);
    if (result.success) this.cache?.invalidate(CK.symbol);
    return result;
  }

  // ─── Cache Management ─────────────────────────────────────────────────────

  /**
   * Return a snapshot of cache performance metrics.
   * Returns `undefined` when caching is not configured.
   */
  getCacheMetrics(): CacheMetrics | undefined {
    return this.cache?.getMetrics();
  }

  /**
   * Evict all cached entries. No-op when caching is not configured.
   */
  clearCache(): void {
    this.cache?.invalidateAll();
  }

  /**
   * Pre-populate the cache with known values (e.g. from SSR or a trusted source).
   * No-op when caching is not configured.
   */
  warmUpCache<T>(entries: CacheWarmEntry<T>[]): void {
    this.cache?.warmUp(entries);
  }

  /**
   * Fetch balances for multiple addresses and cache the results.
   * Useful for warming the cache before rendering a list of balances.
   *
   * @returns Map of address → balance
   */
  async prefetchBalances(addresses: string[]): Promise<Map<string, bigint>> {
    const balances = await this.getBalances(addresses);
    return new Map(addresses.map((addr, i) => [addr, balances[i]]));
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Return a cached value for `key`, or execute `fn`, cache the result, and return it.
   * When caching is disabled the result of `fn` is returned directly.
   */
  private async cached<T>(key: string, fn: () => Promise<T>, ttlMs?: number): Promise<T> {
    if (!this.cache) return fn();
    const hit = this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fn();
    this.cache.set(key, value, ttlMs);
    return value;
  }

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

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new SimulationError(`Query failed: ${simulated.error}`, simulated.error);
        }

        if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
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

        if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
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
