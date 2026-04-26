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
} from '@stellar/stellar-sdk';

import {
  buildInvokeTransaction,
  submitTransaction,
  addressToScVal,
  i128ToScVal,
  stringToScVal,
  u32ToScVal,
  scValToNative,
  hashToScVal,
} from './utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface bcForgeClientConfig {
  /** Soroban RPC endpoint URL (e.g., https://soroban-testnet.stellar.org) */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge token contract ID */
  contractId: string;
}

export interface TransactionResult {
  /** Whether the transaction was successful */
  success: boolean;
  /** Transaction hash */
  hash: string;
  /** Return value from the contract (if any) */
  returnValue?: any;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class bcForgeClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;

  constructor(config: bcForgeClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  /**
   * Get the token balance for an address.
   *
   * @param address - Stellar public key (G... address)
   * @returns Token balance as bigint
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the total token supply.
   *
   * @returns Total supply as bigint
   */
  async getTotalSupply(): Promise<bigint> {
    const result = await this.queryContract('supply', []);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the human-readable token name.
   */
  async getName(): Promise<string> {
    const result = await this.queryContract('name', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the token ticker symbol.
   */
  async getSymbol(): Promise<string> {
    const result = await this.queryContract('symbol', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the number of decimal places.
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

  // ─── Batch Queries ───────────────────────────────────────────────────────

  /**
   * Get token balances for multiple addresses in batches.
   *
   * @param addresses - Array of Stellar public keys
   * @param batchSize - Maximum number of concurrent queries (default: 10)
   * @returns Array of balances as bigints
   */
  async getBalances(addresses: string[], batchSize: number = 10): Promise<bigint[]> {
    return this.executeBatch(addresses, (addr) => this.getBalance(addr), batchSize);
  }

  /**
   * Internal helper to execute a list of async tasks in chunks using Promise.all.
   */
  private async executeBatch<T, R>(
    items: T[],
    task: (item: T) => Promise<R>,
    batchSize: number
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

  /**
   * Initialize the token contract. Can only be called once.
   *
   * @param admin    - Admin address
   * @param decimals - Number of decimal places
   * @param name     - Token name
   * @param symbol   - Token symbol
   * @param source   - Keypair of the transaction signer
   */
  async initialize(
    admin: string,
    decimals: number,
    name: string,
    symbol: string,
    source: Keypair
  ): Promise<TransactionResult> {
    return this.invokeContract('initialize', [
      addressToScVal(admin),
      u32ToScVal(decimals),
      stringToScVal(name),
      stringToScVal(symbol),
    ], source);
  }

  /**
   * Mint tokens to an address. Admin-only.
   *
   * @param to     - Recipient address
   * @param amount - Number of tokens to mint
   * @param source - Admin keypair
   */
  async mint(to: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('mint', [
      addressToScVal(to),
      i128ToScVal(amount),
    ], source);
  }

  /**
   * Transfer tokens between addresses.
   *
   * @param from   - Sender address
   * @param to     - Recipient address
   * @param amount - Number of tokens
   * @param source - Sender's keypair
   */
  async transfer(
    from: string,
    to: string,
    amount: bigint,
    source: Keypair
  ): Promise<TransactionResult> {
    return this.invokeContract('transfer', [
      addressToScVal(from),
      addressToScVal(to),
      i128ToScVal(amount),
    ], source);
  }

  /**
   * Approve a spender to use tokens on your behalf.
   *
   * @param from    - Token owner
   * @param spender - Approved spender
   * @param amount  - Maximum spendable amount
   * @param source  - Owner's keypair
   */
  async approve(
    from: string,
    spender: string,
    amount: bigint,
    source: Keypair
  ): Promise<TransactionResult> {
    return this.invokeContract('approve', [
      addressToScVal(from),
      addressToScVal(spender),
      i128ToScVal(amount),
      u32ToScVal(0), // expiration ledger
    ], source);
  }

  /**
   * Burn tokens from an address.
   *
   * @param from   - Address whose tokens to burn
   * @param amount - Number of tokens to burn
   * @param source - Burner's keypair
   */
  async burn(from: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('burn', [
      addressToScVal(from),
      i128ToScVal(amount),
    ], source);
  }

  /**
   * Transfer admin/ownership to a new address. Current admin only.
   *
   * @param newAdmin - New admin address
   * @param source   - Current admin's keypair
   */
  async transferOwnership(newAdmin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('transfer_ownership', [
      addressToScVal(newAdmin),
    ], source);
  }

  /**
   * Pause all token operations. Admin-only.
   *
   * @param source - Admin keypair
   */
  async pause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('pause', [], source);
  }

  /**
   * Unpause token operations. Admin-only.
   *
   * @param source - Admin keypair
   */
  async unpause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('unpause', [], source);
  }

  /**
   * Upgrades the contract to a new WASM hash. Admin-only.
   *
   * @param newWasmHash - 32-byte hex string or Buffer of the new WASM hash
   * @param source      - Admin keypair
   */
  async upgrade(newWasmHash: string | Buffer, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('upgrade', [
      hashToScVal(newWasmHash),
    ], source);
  }

  /**
   * Update the token name. Admin-only.
   *
   * @param newName - The new token name
   * @param source  - Admin keypair
   */
  async updateName(newName: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_name', [
      stringToScVal(newName),
    ], source);
  }

  /**
   * Update the token symbol. Admin-only.
   *
   * @param newSymbol - The new token symbol
   * @param source    - Admin keypair
   */
  async updateSymbol(newSymbol: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_symbol', [
      stringToScVal(newSymbol),
    ], source);
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Simulates a read-only contract call (no transaction submission).
   */
  private async queryContract(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const account = new (await import('@stellar/stellar-sdk')).Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0'
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
      throw new Error(`Query failed: ${simulated.error}`);
    }

    if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
      throw new Error('Query returned no result');
    }

    return simulated.result.retval;
  }

  /**
   * Builds, signs, submits, and polls a contract invocation transaction.
   */
  private async invokeContract(
    method: string,
    args: xdr.ScVal[],
    source: Keypair
  ): Promise<TransactionResult> {
    const txXdr = await buildInvokeTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      method,
      args,
      source
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
  }
}
