/**
 * @bc-forge/sdk — bcForgeClient
  /**
   * Transfer tokens between addresses.
  /**
   * Approve a spender to use tokens on your behalf.
  /**
   * Burn tokens from an address.
  /**
   * Transfer admin/ownership to a new address (current admin only).
  /**
   * Pause all token operations (admin-only).
   *
   * @param source - Admin `Keypair` signing the pause transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async pause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('pause', [], source);
  }
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

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Configuration used to construct a `bcForgeClient` instance.
  /**
   * Unpause token operations (admin-only).
   *
   * @param source - Admin `Keypair` signing the unpause transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async unpause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('unpause', [], source);
  }
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge token contract ID */
  contractId: string;
}

/**
 * Result shape returned for write operations that produce a transaction.
 *
 * @property success - True when the transaction executed successfully.
 * @property hash - Ledger transaction hash identifying the submitted transaction.
 * @property returnValue - Optional decoded return value from the contract invocation.
 */
export interface TransactionResult {
  /** Whether the transaction was successful */
  success: boolean;
  /** Transaction hash */
  hash: string;
  /** Return value from the contract (if any) */
  returnValue?: any;
}

/**
 * Describes a single recipient for the `batchMint` operation.
 */
export interface BatchMintRecipient {
  /** Recipient Stellar public key (G... address) */
  to: string;
  /** Number of tokens to mint */
  amount: bigint;
}

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * High-level client for interacting with the deployed bc-forge token contract.
 *
 * This class provides convenience methods for querying contract state,
 * building transactions for offline signing, and submitting signed transactions
 * to a Soroban RPC endpoint.
 *
 * Example:
  /**
   * Initialize the token contract. Can only be called once.
   *
   * @param admin - Admin address (G... public key) that will be set as contract admin.
   * @param decimals - Number of decimal places for the token.
   * @param name - Human-readable token name.
   * @param symbol - Token ticker symbol.
   * @param source - Keypair used to sign the initialization transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async initialize(
    admin: string,
    decimals: number,
    name: string,
    symbol: string,
    source: Keypair,
  ): Promise<TransactionResult> {
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  

  /**
   * Get the token balance for an address.
   *
   * @param address - Stellar public key (G... address) to query.
   * @returns Promise resolving to the account balance as a bigint.
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the total token supply.
   *
   * @returns Promise resolving to the total supply as a bigint.
   */
  async getTotalSupply(): Promise<bigint> {
    const result = await this.queryContract('supply', []);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the human-readable token name.
   *
   * @returns Promise resolving to the token name string.
   */
  async getName(): Promise<string> {
    const result = await this.queryContract('name', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the token ticker symbol.
   *
   * @returns Promise resolving to the token symbol string.
   */
  async getSymbol(): Promise<string> {
    const result = await this.queryContract('symbol', []);
    return scValToNative(result) as string;
  }

  /**
   * Get the number of decimal places.
   *
   * @returns Promise resolving to the number of decimals as a number.
   */
  async getDecimals(): Promise<number> {
    const result = await this.queryContract('decimals', []);
    return scValToNative(result) as number;
  }

  /**
   * Get the spending allowance from `owner` to `spender`.
   *
   * @param owner - Owner Stellar public key (G... address).
   * @param spender - Spender Stellar public key (G... address).
   * @returns Promise resolving to the allowance as a bigint.
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
   *
   * @returns Promise resolving to the contract version string.
   */
  async getVersion(): Promise<string> {
    const result = await this.queryContract('version', []);
    return scValToNative(result) as string;
  }

  // ─── Batch Queries ───────────────────────────────────────────────────────

  /**
   * Get token balances for multiple addresses in batches.
   *
   * @param addresses - Array of Stellar public keys to query.
   * @param batchSize - Maximum number of concurrent queries (default: 10).
   * @returns Promise resolving to an array of balances (bigint) in the same order.
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
   * @param admin - Admin address (G... public key) that will be set as contract admin.
   * @param decimals - Number of decimal places for the token.
   * @param name - Human-readable token name.
   * @param symbol - Token ticker symbol.
   * @param source - Keypair used to sign the initialization transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * Mint tokens to an address (admin-only).
   *
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Amount to mint as bigint.
   * @param source - Admin `Keypair` signing the transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async mint(to: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('mint', [addressToScVal(to), i128ToScVal(amount)], source);
  }
    return this.invokeContract('mint', [addressToScVal(to), i128ToScVal(amount)], source);
  }

  /**
   * Batch mint tokens to multiple recipients (admin-only).
   *
   * @param recipients - Array of recipients with `to` and `amount` fields.
   * @param source - Admin `Keypair` signing the transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * @param from - Sender Stellar public key (G... address).
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Amount to transfer as bigint.
   * @param source - Sender's `Keypair` used to sign the transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
      /**
       * Batch mint tokens to multiple recipients (admin-only).
       *
       * @param recipients - Array of recipients with `to` and `amount` fields.
       * @param source - Admin `Keypair` signing the transaction.
       * @returns Promise resolving to a `TransactionResult` describing submission outcome.
       */
      async batchMint(recipients: BatchMintRecipient[], source: Keypair): Promise<TransactionResult> {
   * @param from - Token owner Stellar public key (G... address).
   * @param spender - Spender Stellar public key (G... address).
   * @param amount - Allowance amount as bigint.
   * @param source - Owner's `Keypair` signing the approval transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * @param from - Address whose tokens to burn (G... public key).
   * @param amount - Amount to burn as bigint.
   * @param source - Keypair used to sign the burn transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async burn(from: string, amount: bigint, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('burn', [addressToScVal(from), i128ToScVal(amount)], source);
  }

  /**
   * Transfer admin/ownership to a new address (current admin only).
   *
   * @param newAdmin - New admin Stellar public key (G... address).
   * @param source - Current admin's `Keypair` signing the transfer.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async transferOwnership(newAdmin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('transfer_ownership', [addressToScVal(newAdmin)], source);
  }

  /**
   * Pause all token operations (admin-only).
   *
   * @param source - Admin `Keypair` signing the pause transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async pause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('pause', [], source);
  }

  /**
   * Unpause token operations (admin-only).
   *
   * @param source - Admin `Keypair` signing the unpause transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async unpause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('unpause', [], source);
  }

  // ─── Offline Transaction Builders ──────────────────────────────────────────

  /**
   * Build an unsigned mint transaction XDR for offline signing.
   *
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Number of tokens to mint as bigint.
   * @param sourcePublicKey - Admin's public key to use as tx source.
   * @returns Promise resolving to an unsigned transaction XDR string.
   */
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

  /**
   * Build an unsigned transfer transaction XDR for offline signing.
   *
   * @param from - Sender Stellar public key (G... address).
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Number of tokens as bigint.
   * @param sourcePublicKey - Sender's public key to use as tx source.
   * @returns Promise resolving to an unsigned transaction XDR string.
   */
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

  /**
   * Build an unsigned approve transaction XDR for offline signing.
   *
   * @param from - Token owner Stellar public key (G... address).
   * @param spender - Approved spender Stellar public key (G... address).
   * @param amount - Allowance amount as bigint.
   * @param exp - Expiration ledger (0 for no expiration).
   * @param sourcePublicKey - Owner's public key to use as tx source.
   * @returns Promise resolving to an unsigned transaction XDR string.
   */
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

  /**
   * Build an unsigned burn transaction XDR for offline signing.
   *
   * @param from - Address whose tokens to burn (G... public key).
   * @param amount - Amount to burn as bigint.
   * @param sourcePublicKey - Burner's public key to use as tx source.
   * @returns Promise resolving to an unsigned transaction XDR string.
   */
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

  /**
   * Build an unsigned burnFrom transaction for offline signing.
   *
   * @param spender           - Address authorized to burn tokens
   * @param from              - Token owner address
   * @param amount            - Number of tokens to burn
   * @param sourcePublicKey   - Spender's public key
   * @returns Unsigned transaction XDR string
   */
  async buildBurnFromTx(
    spender: string,
    from: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'burn_from',
      [
        addressToScVal(spender),
        addressToScVal(from),
        i128ToScVal(amount),
      ],
      sourcePublicKey,
    );
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

  /**
   * Simulate a transferFrom operation.
   *
   * @param spender           - Address authorized to spend tokens
   * @param from              - Token owner address
   * @param to                - Recipient address
   * @param amount            - Number of tokens to transfer
   * @param sourcePublicKey   - Spender's public key
   * @returns Simulation result
   */
  async simulateTransferFrom(
    spender: string,
    from: string,
    to: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<any> {
    return this.simulate(
      'transfer_from',
      [
        addressToScVal(spender),
        addressToScVal(from),
        addressToScVal(to),
        i128ToScVal(amount),
      ],
      sourcePublicKey,
    );
  }

  /**
   * Simulate a burn operation.
   *
   * @param from              - Address whose tokens to burn
   * @param amount            - Number of tokens to burn
   * @param sourcePublicKey   - Burner's public key
   * @returns Simulation result
   */
  async simulateBurn(
    from: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<any> {
    return this.simulate(
      'burn',
      [addressToScVal(from), i128ToScVal(amount)],
      sourcePublicKey,
    );
  }

  /**
   * Simulate a burnFrom operation.
   *
   * @param spender           - Address authorized to burn tokens
   * @param from              - Token owner address
   * @param amount            - Number of tokens to burn
   * @param sourcePublicKey   - Spender's public key
   * @returns Simulation result
   */
  async simulateBurnFrom(
    spender: string,
    from: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<any> {
    return this.simulate(
      'burn_from',
      [
        addressToScVal(spender),
        addressToScVal(from),
        i128ToScVal(amount),
      ],
      sourcePublicKey,
    );
  }

  /**
   * Dry-run a transaction to estimate fees and resources without submitting.
   *
   * @param txXdr - Transaction XDR string to simulate
   * @returns Simulation result with estimated resources, fees, and potential return value
   */
  async simulateTx(txXdr: string): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    return this.withRetry(async () => {
      try {
        const tx = TransactionBuilder.fromXDR(txXdr, this.networkPassphrase);
        const simulated = await this.server.simulateTransaction(tx);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new SimulationError(`Simulation failed: ${simulated.error}`, simulated.error);
        }

        return simulated;
      } catch (error: any) {
        if (error instanceof SimulationError) throw error;
        throw new RPCError('RPC simulation failed', error);
      }
    });
  }

  // ─── Multi-Sig / Admin Pool ──────────────────────────────────────────────

  /**
   * Configure the multi-signature admin pool.
   *
   * @param pool - Array of admin Stellar public keys (G... addresses).
   * @param threshold - Quorum threshold (number of approvals required).
   * @param source - Current admin `Keypair` signing the configuration transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * Upgrade the contract to a new WASM hash (admin-only).
   *
   * @param newWasmHash - 32-byte hex string or Buffer of the new WASM hash.
   * @param source - Admin `Keypair` signing the upgrade transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async upgrade(newWasmHash: string | Buffer, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('upgrade', [hashToScVal(newWasmHash)], source);
  }

  /**
   * Propose a sensitive action for multi-sig approval.
   *
   * @param admin - Proposing admin Stellar public key (G... address).
   * @param action - The action to propose. Supported shapes: `{ Mint: [to, amount] }`, `{ Pause: [] }`, `{ Unpause: [] }`.
   * @param description - Human-readable description of the proposal.
   * @param source - Proposing admin `Keypair` signing the proposal transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * Approve a pending multi-sig proposal.
   *
   * @param admin - Admin Stellar public key approving the proposal.
   * @param proposalId - Proposal identifier as bigint.
   * @param source - Admin `Keypair` signing the approval.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * Execute an approved proposal once quorum is reached.
   *
   * @param proposalId - Proposal identifier as bigint.
   * @param source - Admin `Keypair` executing the proposal.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * Set the designated clawback administrator (admin-only).
   *
   * @param admin - Clawback administrator Stellar public key (G... address).
   * @param source - Admin `Keypair` signing the transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async setClawbackAdmin(admin: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('set_clawback_admin', [addressToScVal(admin)], source);
  }

  /**
   * Update the token name (admin-only).
   *
   * @param newName - The new token name string.
   * @param source - Admin `Keypair` signing the update.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async updateName(newName: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_name', [stringToScVal(newName)], source);
  }

  /**
   * Execute a clawback operation.
   *
   * @param from - Address to claw back from (G... public key).
   * @param to - Recipient address to receive clawed funds (G... public key).
   * @param amount - Amount to claw back as bigint.
   * @param source - Admin `Keypair` signing the clawback transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   *
   * @param user - User Stellar public key (G... address) whose tokens will be locked.
   * @param amount - Amount to lock as bigint.
   * @param unlockTime - Timestamp (u64) when tokens become withdrawable.
   * @param source - Admin or controller `Keypair` signing the lock transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
   * Withdraw matured locked tokens for a user.
   *
   * @param user - User Stellar public key (G... address) to withdraw for.
   * @param source - `Keypair` signing the withdrawal transaction.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
   */
  async withdrawLocked(user: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('withdraw_locked', [addressToScVal(user)], source);
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  /**
   * Get recent events for the contract via Soroban RPC.
   *
   * @param startLedger - Optional ledger sequence to start from. If omitted, defaults to latest ledger - 1000.
   * @returns Promise resolving to an array of raw event objects returned by the RPC.
   */
  async getEvents(startLedger?: number): Promise<any[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  /**
   * Update the token symbol (admin-only).
   *
   * @param newSymbol - The new token symbol string.
   * @param source - Admin `Keypair` signing the update.
   * @returns Promise resolving to a `TransactionResult` describing submission outcome.
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
        const txXdr = await buildInvokeTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          source,
        );

        const response = await submitTransaction(this.rpcUrl, txXdr, this.networkPassphrase);

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
        // Don't retry on simulation errors (usually logic errors)
        if (error instanceof SimulationError) throw error;
        throw error;
      }
    });
  }
}
