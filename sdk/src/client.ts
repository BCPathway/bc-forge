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

export interface BatchMintRecipient {
  /** Recipient Stellar public key (G... address) */
  to: string;
  /** Number of tokens to mint */
  amount: bigint;
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
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'initialize',
      [addressToScVal(admin), u32ToScVal(decimals), stringToScVal(name), stringToScVal(symbol)],
      source,
    );
  }

  /**
   * Mint tokens to an address. Admin-only.
   *
   * @param to     - Recipient address
   * @param amount - Number of tokens to mint
   * @param source - Admin keypair
   */
  async mint(to: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('mint', [addressToScVal(to), i128ToScVal(amount)], source);
  }

  /**
   * Batch mint tokens to multiple recipients. Admin-only.
   *
   * @param recipients - Array of recipient objects
   * @param source     - Admin keypair
   */
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
    return this.invokeContract('batch_mint', [recipientsVec], source);
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
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
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
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'approve',
      [
        addressToScVal(from),
        addressToScVal(spender),
        i128ToScVal(amount),
        u32ToScVal(0), // expiration ledger
      ],
      source,
    );
  }

  /**
   * Burn tokens from an address.
   *
   * @param from   - Address whose tokens to burn
   * @param amount - Number of tokens to burn
   * @param source - Burner's keypair
   */
  async burn(from: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('burn', [addressToScVal(from), i128ToScVal(amount)], source);
  }

  /**
   * Transfer admin/ownership to a new address. Current admin only.
   *
   * @param newAdmin - New admin address
   * @param source   - Current admin's keypair
   */
  async transferOwnership(newAdmin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('transfer_ownership', [addressToScVal(newAdmin)], source);
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

  // ─── Offline Transaction Builders ──────────────────────────────────────────

  /**
   * Build an unsigned transaction XDR for offline signing.
   *
   * @param method - Contract method name
   * @param args - Method arguments as ScVal array
   * @param sourcePublicKey - Public key of the source account
   * @returns Unsigned transaction XDR string
   */
  async buildUnsignedTx(
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      method,
      args,
      sourcePublicKey,
    );
  }

  /**
   * Submit a signed transaction XDR to the network and poll for the result.
   *
   * @param txXdr - Signed transaction XDR string
   * @returns Transaction result
   */
  async submitTx(txXdr: string): Promise<TransactionResult> {
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

  /**
   * Build an unsigned initialize transaction for offline signing.
   */
  async buildInitializeTx(
    admin: string,
    decimals: number,
    name: string,
    symbol: string,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'initialize',
      [addressToScVal(admin), u32ToScVal(decimals), stringToScVal(name), stringToScVal(symbol)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned mint transaction for offline signing.
   *
   * @param to              - Recipient address
   * @param amount          - Number of tokens to mint
   * @param sourcePublicKey - Admin's public key
   * @returns Unsigned transaction XDR string
   */
  async buildMintTx(to: string, amount: bigint, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('mint', [addressToScVal(to), i128ToScVal(amount)], sourcePublicKey);
  }

  /**
   * Build an unsigned batch mint transaction for offline signing.
   */
  async buildBatchMintTx(
    recipients: BatchMintRecipient[],
    sourcePublicKey: string,
  ): Promise<string> {
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
    return this.buildUnsignedTx('batch_mint', [recipientsVec], sourcePublicKey);
  }

  /**
   * Build an unsigned transfer transaction for offline signing.
   *
   * @param from            - Sender address
   * @param to              - Recipient address
   * @param amount          - Number of tokens
   * @param sourcePublicKey - Sender's public key
   * @returns Unsigned transaction XDR string
   */
  async buildTransferTx(
    from: string,
    to: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned approve transaction for offline signing.
   *
   * @param from            - Token owner
   * @param spender         - Approved spender
   * @param amount          - Maximum spendable amount
   * @param exp             - Expiration ledger (0 for no expiration)
   * @param sourcePublicKey - Owner's public key
   * @returns Unsigned transaction XDR string
   */
  async buildApproveTx(
    from: string,
    spender: string,
    amount: bigint,
    exp: number,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'approve',
      [addressToScVal(from), addressToScVal(spender), i128ToScVal(amount), u32ToScVal(exp)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned burn transaction for offline signing.
   *
   * @param from            - Address whose tokens to burn
   * @param amount          - Number of tokens to burn
   * @param sourcePublicKey - Burner's public key
   * @returns Unsigned transaction XDR string
   */
  async buildBurnTx(from: string, amount: bigint, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx(
      'burn',
      [addressToScVal(from), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned transfer ownership transaction for offline signing.
   */
  async buildTransferOwnershipTx(newAdmin: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('transfer_ownership', [addressToScVal(newAdmin)], sourcePublicKey);
  }

  /**
   * Build an unsigned pause transaction for offline signing.
   */
  async buildPauseTx(sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('pause', [], sourcePublicKey);
  }

  /**
   * Build an unsigned unpause transaction for offline signing.
   */
  async buildUnpauseTx(sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('unpause', [], sourcePublicKey);
  }

  /**
   * Build an unsigned set admin pool transaction for offline signing.
   */
  async buildSetAdminPoolTx(
    pool: string[],
    threshold: number,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'set_admin_pool',
      [
        nativeToScVal(
          pool.map((addr) => addressToScVal(addr)),
          { type: 'vec' },
        ),
        u32ToScVal(threshold),
      ],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned upgrade transaction for offline signing.
   */
  async buildUpgradeTx(newWasmHash: string | Buffer, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('upgrade', [hashToScVal(newWasmHash)], sourcePublicKey);
  }

  /**
   * Build an unsigned propose action transaction for offline signing.
   */
  async buildProposeActionTx(
    admin: string,
    action: { Mint: [string, bigint] } | { Pause: [] } | { Unpause: [] },
    description: string,
    sourcePublicKey: string,
  ): Promise<string> {
    const actionScVal =
      'Mint' in action
        ? nativeToScVal({
            Mint: [addressToScVal(action.Mint[0]), i128ToScVal(action.Mint[1])],
          })
        : nativeToScVal(action);

    return this.buildUnsignedTx(
      'propose_action',
      [addressToScVal(admin), actionScVal, stringToScVal(description)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned approve proposal transaction for offline signing.
   */
  async buildApproveProposalTx(
    admin: string,
    proposalId: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'approve_proposal',
      [addressToScVal(admin), nativeToScVal(proposalId, { type: 'u64' })],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned execute proposal transaction for offline signing.
   */
  async buildExecuteProposalTx(proposalId: bigint, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx(
      'execute_proposal',
      [nativeToScVal(proposalId, { type: 'u64' })],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned set clawback admin transaction for offline signing.
   */
  async buildSetClawbackAdminTx(admin: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('set_clawback_admin', [addressToScVal(admin)], sourcePublicKey);
  }

  /**
   * Build an unsigned update name transaction for offline signing.
   */
  async buildUpdateNameTx(newName: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('update_name', [stringToScVal(newName)], sourcePublicKey);
  }

  /**
   * Build an unsigned clawback transaction for offline signing.
   */
  async buildClawbackTx(
    from: string,
    to: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'clawback',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned lock tokens transaction for offline signing.
   */
  async buildLockTokensTx(
    user: string,
    amount: bigint,
    unlockTime: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx(
      'lock_tokens',
      [addressToScVal(user), i128ToScVal(amount), nativeToScVal(unlockTime, { type: 'u64' })],
      sourcePublicKey,
    );
  }

  /**
   * Build an unsigned withdraw locked tokens transaction for offline signing.
   */
  async buildWithdrawLockedTx(user: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('withdraw_locked', [addressToScVal(user)], sourcePublicKey);
  }

  /**
   * Build an unsigned update symbol transaction for offline signing.
   */
  async buildUpdateSymbolTx(newSymbol: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('update_symbol', [stringToScVal(newSymbol)], sourcePublicKey);
  }

  /**
   * Sign an unsigned transaction XDR.
   *
   * @param txXdr - Unsigned transaction XDR string
   * @param keypair - Keypair to sign with
   * @returns Signed transaction XDR string
   */
  signTx(txXdr: string, keypair: Keypair): string {
    return signTransaction(txXdr, this.networkPassphrase, keypair);
  }

  /**
   * Simulate a contract invocation without submitting.
   *
   * @param method - Contract method name
   * @param args - Method arguments as ScVal array
   * @param sourcePublicKey - Public key for simulation context
   * @returns Simulation result with return value and cost
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
   * Simulate a mint operation.
   *
   * @param to - Recipient address
   * @param amount - Number of tokens to mint
   * @param sourcePublicKey - Admin's public key
   * @returns Simulation result
   */
  async simulateMint(to: string, amount: bigint, sourcePublicKey: string): Promise<any> {
    return this.simulate('mint', [addressToScVal(to), i128ToScVal(amount)], sourcePublicKey);
  }

  /**
   * Simulate a transfer operation.
   *
   * @param from - Sender address
   * @param to - Recipient address
   * @param amount - Number of tokens
   * @param sourcePublicKey - Sender's public key
   * @returns Simulation result
   */
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

  /**
   * Configure the multi-signature admin pool.
   *
   * @param pool      - Array of admin addresses
   * @param threshold - Quorum threshold
   * @param source    - Current admin keypair
   */
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

  /**
   * Upgrades the contract to a new WASM hash. Admin-only.
   *
   * @param newWasmHash - 32-byte hex string or Buffer of the new WASM hash
   * @param source      - Admin keypair
   */
  async upgrade(newWasmHash: string | Buffer, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('upgrade', [hashToScVal(newWasmHash)], source);
  }

  /**
   * Propose a sensitive action for multi-sig approval.
   *
   * @param admin       - Proposing admin address
   * @param action      - The action to propose (Mint, Pause, or Unpause)
   * @param description - Human-readable description
   * @param source      - Proposing admin keypair
   */
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

  /**
   * Approve a pending proposal.
   */
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

  /**
   * Execute a proposal once quorum is reached.
   */
  async executeProposal(proposalId: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'execute_proposal',
      [nativeToScVal(proposalId, { type: 'u64' })],
      source,
    );
  }

  // ─── Clawback / Regulatory ───────────────────────────────────────────────

  /**
   * Set the designated clawback administrator.
   */
  async setClawbackAdmin(admin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('set_clawback_admin', [addressToScVal(admin)], source);
  }

  /**
   * Update the token name. Admin-only.
   *
   * @param newName - The new token name
   * @param source  - Admin keypair
   */
  async updateName(newName: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_name', [stringToScVal(newName)], source);
  }

  /**
   * Execute a clawback operation.
   */
  async clawback(
    from: string,
    to: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'clawback',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
  }

  // ─── Locking / Vesting ───────────────────────────────────────────────────

  /**
   * Lock tokens for a user until a specific timestamp.
   */
  async lockTokens(
    user: string,
    amount: bigint,
    unlockTime: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'lock_tokens',
      [addressToScVal(user), i128ToScVal(amount), nativeToScVal(unlockTime, { type: 'u64' })],
      source,
    );
  }

  /**
   * Withdraw matured locked tokens.
   */
  async withdrawLocked(user: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('withdraw_locked', [addressToScVal(user)], source);
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  /**
   * Get recent events for the contract.
   */
  async getEvents(startLedger?: number): Promise<any[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  /**
   * Update the token symbol. Admin-only.
   *
   * @param newSymbol - The new token symbol
   * @param source    - Admin keypair
   */
  async updateSymbol(newSymbol: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_symbol', [stringToScVal(newSymbol)], source);
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Internal helper to execute a task with retries.
   */
  private async withRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: any;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        // Only retry on certain errors (e.g., network/RPC errors)
        // For now, we retry on any error that isn't a known terminal error
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    throw lastError;
  }

  /**
   * Simulates a read-only contract call (no transaction submission).
   */
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

  /**
   * Builds, signs, submits, and polls a contract invocation transaction.
   */
  private async invokeContract(
    method: string,
    args: xdr.ScVal[],
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.withRetry(async () => {
      try {
        const unsignedTx = await buildUnsignedTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          source.publicKey(),
        );

        const signedTx = signTransaction(unsignedTx, this.networkPassphrase, source);

        return await this.submitTx(signedTx);
      } catch (error: any) {
        // Don't retry on simulation errors (usually logic errors)
        if (error instanceof SimulationError) throw error;
        throw error;
      }
    });
  }
}
