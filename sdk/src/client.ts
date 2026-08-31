/**
 * @bc-forge/sdk — bcForgeClient
 *
 * High-level TypeScript client for interacting with deployed bc-forge
 * token contracts on the Stellar/Soroban network.
 */

/**
 * The canonical zero-address sentinel: an ed25519 public key whose 32-byte
 * payload is all zeros. No private key can ever produce a signature for it.
 * This constant is used for zero-address validation across the SDK.
 */
export const ZERO_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

/**
 * Returns `true` if the given address is the canonical zero-address sentinel.
 *
 * The zero address ("GAAAA…WHF") is an ed25519 public key whose 32-byte
 * payload is all zeros. No private key can ever produce a signature for it,
 * so holding a role there would be unrecoverable.
 *
 * @param address - Stellar public key (G... address) to check
 * @returns `true` if the address equals the zero-address sentinel, `false` otherwise
 *
 * @example
 * ```typescript
 * if (isZeroAddress(someAddress)) {
 *   throw new Error('Invalid address: zero address is not allowed');
 * }
 * ```
 */
export function isZeroAddress(address: string): boolean {
  return address === ZERO_ADDRESS;
}

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
  /** Optional wallet adapter for browser-based signing flows */
  walletAdapter?: WalletAdapter;
}

export interface TransactionResult {
  /** Whether the transaction was successful */
  success: boolean;
  /** Transaction hash */
  hash: string;
  /** Return value from the contract (if any) */
  returnValue?: unknown;
}

export interface RbacInitResult {
  /** Result of the `migrate_admin` bootstrap transaction */
  migrate: TransactionResult;
  /** Result of the `grant_role` transaction assigning the initial SuperAdmin */
  grant: TransactionResult;
}

export interface BatchMintRecipient {
  /** Recipient Stellar public key (G... address) */
  to: string;
  /** Number of tokens to mint */
  amount: bigint;
}

/** Role for role-based access control */
export enum Role {
  Admin = 'Admin',
  SuperAdmin = 'SuperAdmin',
  Minter = 'Minter',
  Pauser = 'Pauser',
}

/**
 * Serialize a {@link Role} to the symbol ScVal the contract expects.
 *
 * The contract encodes `Role` as a symbol (`SuperAdmin`, `Minter`, …), so
 * plain-string `nativeToScVal` (which produces `scvString`) is not ABI
 * compatible with `grant_role` / `revoke_role` / `has_role`.
 */
function roleToScVal(role: Role): xdr.ScVal {
  return xdr.ScVal.scvSymbol(role);
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class bcForgeClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;
  private walletAdapter?: WalletAdapter;

  constructor(config: bcForgeClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
    this.walletAdapter = config.walletAdapter;
  }

  /** Replace or set the wallet adapter at runtime */
  setWalletAdapter(adapter?: WalletAdapter) {
    this.walletAdapter = adapter;
  }

  /** Connect the configured wallet adapter (if any) */
  async connectWallet(): Promise<string | undefined> {
    if (!this.walletAdapter) throw new Error('No wallet adapter configured');
    await this.walletAdapter.connect();
    return this.walletAdapter.publicKey;
  }

  /** Disconnect the configured wallet adapter (if any) */
  async disconnectWallet(): Promise<void> {
    if (!this.walletAdapter) return;
    await this.walletAdapter.disconnect();
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  /**
   * Get the token balance for an address.
   *
   * @param address - Stellar public key (G... address)
   * @returns Token balance as a fixed-scale decimal string.
   */
  async getBalance(address: string): Promise<bigint> {
    const result = await this.queryContract('balance', [addressToScVal(address)]);
    return BigInt(scValToNative(result) as string | number | bigint);
  }

  /**
   * Get the total token supply.
   *
   * @returns Total supply as bigint
   */
  async getTotalSupply(): Promise<bigint> {
    const result = await this.queryContract('supply', []);
    return BigInt(scValToNative(result) as string | number | bigint);
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
    return BigInt(scValToNative(result) as string | number | bigint);
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
   * @returns Array of balances as bigint values.
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
    source?: Keypair,
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
    return this.invokeContract(
      'mint',
      [addressToScVal(source.publicKey()), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
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
          key: xdr.ScVal.scvSymbol('to'),
          val: addressToScVal(to),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('amount'),
          val: i128ToScVal(amount),
        }),
      ]),
    );
    const recipientsVec = xdr.ScVal.scvVec(recipientScVals);
    return this.invokeContract(
      'batch_mint',
      [addressToScVal(source.publicKey()), recipientsVec],
      source,
    );
  }

  /**
   * Batch transfer tokens to multiple recipients. Sender's keypair must authorize the transaction.
   *
   * @param from     - Sender address
   * @param recipients - Array of recipient objects with address and amount
   * @param source   - Sender's keypair
   */
  async batchTransfer(
    from: string,
    recipients: BatchMintRecipient[],
    source: Keypair,
  ): Promise<TransactionResult> {
    const recipientsVec = xdr.ScVal.scvVec(
      recipients.map(({ to, amount }) =>
        xdr.ScVal.scvVec([addressToScVal(to), i128ToScVal(amount)]),
      ),
    );
    return this.invokeContract('batch_transfer', [addressToScVal(from), recipientsVec], source);
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
    source?: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'transfer',
      [addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
      source,
    );
  }

  /**
   * Transfer tokens from one address to another using an approved allowance.
   *
   * @param spender - Address authorized to spend tokens
   * @param from    - Token owner address
   * @param to      - Recipient address
   * @param amount  - Number of tokens to transfer
   * @param source  - Spender's keypair
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
    source?: Keypair,
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
  async burn(from: string, amount: bigint, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('burn', [addressToScVal(from), i128ToScVal(amount)], source);
  }

  /**
/**
   * Burn tokens from an address using an approved allowance.
   *
   * @param spender - Address authorized to burn tokens
   * @param from    - Token owner address
   * @param amount  - Number of tokens to burn
   * @param source  - Spender's keypair
   */
  async burnFrom(
    spender: string,
    from: string,
    amount: bigint,
    source: Keypair,
  ): Promise<TransactionResult> {
    return this.invokeContract(
      'burn_from',
      [addressToScVal(spender), addressToScVal(from), i128ToScVal(amount)],
      source,
    );
  }

  /**
   * Transfer admin/ownership to a new address. Current admin only.
   *
   * @param newAdmin - New admin address
   * @param source   - Current admin's keypair
   */
  async transferOwnership(newAdmin: string, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('transfer_ownership', [addressToScVal(newAdmin)], source);
  }

  /**
   * Pause all token operations. Admin or Pauser-only.
   *
   * @param source - Admin or Pauser keypair
   */
  async pause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('pause', [addressToScVal(source.publicKey())], source);
  }

  /**
   * Unpause token operations. Admin or Pauser-only.
   *
   * @param source - Admin or Pauser keypair
   */
  async unpause(source: Keypair): Promise<TransactionResult> {
    return this.invokeContract('unpause', [addressToScVal(source.publicKey())], source);
  }

  // ─── Offline Transaction Builders ──────────────────────────────────────────

  /**
   * Build an unsigned mint transaction for offline signing.
   *
   * @param to              - Recipient address
   * @param amount          - Number of tokens to mint
   * @param sourcePublicKey - Admin's public key
   * @returns Unsigned transaction XDR string
   */
  async buildMintTx(to: string, amount: bigint, sourcePublicKey: string): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'mint',
      [addressToScVal(sourcePublicKey), addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
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
   * Build an unsigned transferFrom transaction for offline signing.
   *
   * @param spender           - Address authorized to spend tokens
   * @param from              - Token owner address
   * @param to                - Recipient address
   * @param amount            - Number of tokens to transfer
   * @param sourcePublicKey   - Spender's public key
   * @returns Unsigned transaction XDR string
   */
  async buildTransferFromTx(
    spender: string,
    from: string,
    to: string,
    amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return buildUnsignedTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      'transfer_from',
      [addressToScVal(spender), addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
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
   * Build an unsigned burn transaction for offline signing.
   *
   * @param from            - Address whose tokens to burn
   * @param amount          - Number of tokens to burn
   * @param sourcePublicKey - Burner's public key
   * @returns Unsigned transaction XDR string
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
      [addressToScVal(spender), addressToScVal(from), i128ToScVal(amount)],
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
   * Simulate a mint operation.
   *
   * @param to - Recipient address
   * @param amount - Number of tokens to mint
   * @param sourcePublicKey - Admin's public key
   * @returns Simulation result
   */
  async simulateMint(to: string, amount: bigint, sourcePublicKey: string): Promise<unknown> {
    return this.simulate(
      'mint',
      [addressToScVal(sourcePublicKey), addressToScVal(to), i128ToScVal(amount)],
      sourcePublicKey,
    );
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
  ): Promise<unknown> {
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
  ): Promise<unknown> {
    return this.simulate(
      'transfer_from',
      [addressToScVal(spender), addressToScVal(from), addressToScVal(to), i128ToScVal(amount)],
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
  async simulateBurn(from: string, amount: bigint, sourcePublicKey: string): Promise<unknown> {
    return this.simulate('burn', [addressToScVal(from), i128ToScVal(amount)], sourcePublicKey);
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
  ): Promise<unknown> {
    return this.simulate(
      'burn_from',
      [addressToScVal(spender), addressToScVal(from), i128ToScVal(amount)],
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
      } catch (error: unknown) {
        if (error instanceof SimulationError) throw error;
        throw new RPCError('RPC simulation failed', error);
      }
    });
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
      [xdr.ScVal.scvVec(pool.map((addr) => addressToScVal(addr))), u32ToScVal(threshold)],
      source,
    );
  }

  /**
   * Upgrades the contract to a new WASM hash. Admin-only.
   *
   * @param newWasmHash - 32-byte hex string or Buffer of the new WASM hash
   * @param source      - Admin keypair
   */
  async upgrade(newWasmHash: string | Buffer, source?: Keypair): Promise<TransactionResult> {
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
    source?: Keypair,
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
    source?: Keypair,
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
  async executeProposal(proposalId: bigint, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'execute_proposal',
      [nativeToScVal(proposalId, { type: 'u64' })],
      source,
    );
  }

  // ─── RBAC / Role Management ────────────────────────────────────────────────

  /**
   * Get the current contract admin address on-chain.
   */
  async getAdmin(): Promise<string> {
    try {
      const result = await this.queryContract('admin', []);
      return scValToNative(result) as string;
    } catch {
      // Fallback for contracts with get_admin entrypoint
      const result = await this.queryContract('get_admin', []);
      return scValToNative(result) as string;
    }
  }

  /**
   * Check whether an address holds a specific role on-chain.
   *
   * @param role    - The role to check (e.g. Role.SuperAdmin, Role.Admin, Role.Minter)
   * @param address - Stellar public key or contract address
   */
  async hasRole(role: Role, address: string): Promise<boolean> {
    try {
      const result = await this.queryContract('has_role', [
        roleToScVal(role),
        addressToScVal(address),
      ]);
      return Boolean(scValToNative(result));
    } catch {
      // Fallback if role is verified via admin check (Admin implicitly satisfies all roles)
      const admin = await this.getAdmin().catch(() => undefined);
      if (admin && admin === address) {
        return true;
      }
      return false;
    }
  }

  /**
   * Verify that an address holds the SuperAdmin role on-chain.
   *
   * @param address - Address to verify
   */
  async verifySuperAdmin(address: string): Promise<boolean> {
    const isSuperAdmin = await this.hasRole(Role.SuperAdmin, address).catch(() => false);
    if (isSuperAdmin) return true;
    const admin = await this.getAdmin().catch(() => undefined);
    return admin === address;
  }

  /**
   * Grant any role to an address. SuperAdmin/Admin-only.
   *
   * @param role    - Role to grant
   * @param address - Address to receive the role
   * @param source  - SuperAdmin/Admin keypair
   */
  async grantRole(role: Role, address: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'grant_role',
      [addressToScVal(source.publicKey()), roleToScVal(role), addressToScVal(address)],
      source,
    );
  }

  /**
   * Revoke any role from an address. SuperAdmin/Admin-only.
   *
   * @param role    - Role to revoke
   * @param address - Address to revoke the role from
   * @param source  - SuperAdmin/Admin keypair
   */
  async revokeRole(role: Role, address: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'revoke_role',
      [addressToScVal(source.publicKey()), roleToScVal(role), addressToScVal(address)],
      source,
    );
  }

  /**
   * Grant the Minter role to an address. Admin-only.
   *
   * @remarks
   * The caller (`source`) must hold the SuperAdmin role. The contract will
   * revert if the caller is unauthorized, the target address is the zero
   * address, or the role is not recognized.
   *
   * Granting an already-held role is idempotent.
   *
   * @param address - Address to grant the Minter role to
   * @param source  - Admin keypair (must hold SuperAdmin role)
   * @throws {ContractError} If the caller lacks SuperAdmin role (`UnauthorizedRole`)
   * @throws {ContractError} If the address is the zero address (`InvalidAddress`)
   * @throws {ContractError} If the role variant is unrecognized (`InvalidRole`)
   */
  async grantMinter(address: string, source: Keypair): Promise<TransactionResult> {
    return this.grantRole(Role.Minter, address, source);
  }

  /**
   * Revoke the Minter role from an address. Admin-only.
   *
   * @remarks
   * The caller (`source`) must hold the SuperAdmin role. The contract will
   * revert if the caller is unauthorized, the target address is the zero
   * address, or the role is not recognized. Returns an error (rather than
   * panicking) if the address does not hold the Minter role.
   *
   * @param address - Address to revoke the Minter role from
   * @param source  - Admin keypair (must hold SuperAdmin role)
   * @throws {ContractError} If the caller lacks SuperAdmin role (`UnauthorizedRole`)
   * @throws {ContractError} If the address is the zero address (`InvalidAddress`)
   * @throws {ContractError} If the role variant is unrecognized (`InvalidRole`)
   * @throws {ContractError} If the address does not hold the Minter role (`RoleNotHeld`)
   */
  async revokeMinter(address: string, source: Keypair): Promise<TransactionResult> {
    return this.revokeRole(Role.Minter, address, source);
  }

  /**
   * Connect an Admin Contract ID to the Token Contract. Admin-only.
   *
   * @param adminContractId - The deployed Admin Contract ID
   * @param source          - Admin keypair
   */
  async setAdminContract(adminContractId: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'set_admin_contract',
      [addressToScVal(source.publicKey()), addressToScVal(adminContractId)],
      source,
    );
  }

  /**
   * Connect a Token Contract ID to a dependent contract (e.g. Vesting or Wrapper). Admin-only.
   *
   * @param tokenContractId - The deployed Token Contract ID
   * @param source          - Admin keypair
   */
  async setDependentToken(tokenContractId: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'set_token',
      [addressToScVal(source.publicKey()), addressToScVal(tokenContractId)],
      source,
    );
  }

  /**
   * Grant the SuperAdmin role to an address. Admin/SuperAdmin-only.
   *
   * @remarks
   * This is the RBAC initialization step that assigns the initial `SuperAdmin`.
   * The caller (`source`) must hold the `SuperAdmin` role — the configured
   * contract admin implicitly satisfies this, so the admin keypair can bootstrap
   * the role hierarchy right after `initialize`.
   *
   * @param address - Address to grant the SuperAdmin role to
   * @param source  - Admin keypair (must hold SuperAdmin role)
   * @throws {ContractError} If the caller lacks SuperAdmin role (`UnauthorizedRole`)
   * @throws {ContractError} If the address is the zero address (`InvalidAddress`)
   * @throws {ContractError} If the role variant is unrecognized (`InvalidRole`)
   */
  async grantSuperAdmin(address: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'grant_role',
      [addressToScVal(source.publicKey()), roleToScVal(Role.SuperAdmin), addressToScVal(address)],
      source,
    );
  }

  /**
   * Revoke the SuperAdmin role from an address. Admin/SuperAdmin-only.
   *
   * @remarks
   * The caller (`source`) must hold the `SuperAdmin` role. Returns an error
   * (rather than panicking) if the address does not hold the SuperAdmin role.
   *
   * @param address - Address to revoke the SuperAdmin role from
   * @param source  - Admin keypair (must hold SuperAdmin role)
   * @throws {ContractError} If the caller lacks SuperAdmin role (`UnauthorizedRole`)
   * @throws {ContractError} If the address does not hold the SuperAdmin role (`RoleNotHeld`)
   */
  async revokeSuperAdmin(address: string, source: Keypair): Promise<TransactionResult> {
    return this.invokeContract(
      'revoke_role',
      [addressToScVal(source.publicKey()), roleToScVal(Role.SuperAdmin), addressToScVal(address)],
      source,
    );
  }

  /**
   * Initialize role-based access control for a freshly deployed contract.
   *
   * @remarks
   * The `init_rbac` deployment step. Runs two sequential transactions:
   *
   * 1. `migrate_admin` — bootstraps the persistent `SuperAdmin(admin)` mapping
   *    from the configured contract admin (idempotent, safe on new contracts).
   * 2. `grant_role(SuperAdmin, superAdmin)` — assigns the initial `SuperAdmin`
   *    role to the designated address, so it can grant/revoke roles going forward.
   *
   * Call this immediately after `initialize` during deployment.
   *
   * @param superAdmin - Address to assign the initial SuperAdmin role to
   * @param source     - Admin keypair that signs both transactions
   * @returns Results of both the `migrate_admin` and `grant_role` transactions
   */
  async initRbac(superAdmin: string, source: Keypair): Promise<RbacInitResult> {
    const migrate = await this.invokeContract('migrate_admin', [], source);
    const grant = await this.invokeContract(
      'grant_role',
      [
        addressToScVal(source.publicKey()),
        roleToScVal(Role.SuperAdmin),
        addressToScVal(superAdmin),
      ],
      source,
    );
    return { migrate, grant };
  }

  // ─── RBAC Migration ──────────────────────────────────────────────────────

  /**
   * Migrate the legacy admin address to the SuperAdmin role mapping.
   *
   * @remarks
   * This is a one-shot, idempotent storage migration that copies the singular
   * admin address from `AdminKey::Admin` (instance storage) to
   * `AdminKey::SuperAdmin(admin)` (persistent storage). This enables the
   * `require_super_admin` guard for legacy contracts without resetting state.
   *
   * Safe to call multiple times — subsequent calls are no-ops.
   *
   * @param source - Admin keypair (must be the contract admin to authorize migration)
   * @returns TransactionResult with migration status
   */
  async migrateAdmin(source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('migrate_admin', [], source);
  }

  // ─── Clawback / Regulatory ───────────────────────────────────────────────

  /**
   * Set the designated clawback administrator.
   */
  async setClawbackAdmin(admin: string, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('set_clawback_admin', [addressToScVal(admin)], source);
  }

  /**
   * Update the token name. Admin-only.
   *
   * @param newName - The new token name
   * @param source  - Admin keypair
   */
  async updateName(newName: string, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_name', [stringToScVal(newName)], source);
  }

  /**
   * Execute a clawback operation.
   */
  async clawback(
    from: string,
    to: string,
    amount: bigint,
    source?: Keypair,
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
    source?: Keypair,
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
  async withdrawLocked(user: string, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('withdraw_locked', [addressToScVal(user)], source);
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  /**
   * Get recent events for the contract.
   */
  async getEvents(startLedger?: number): Promise<unknown[]> {
    const response = await this.server.getEvents({
      startLedger: startLedger || (await this.server.getLatestLedger()).sequence - 1000,
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    });
    return response.events;
  }

  /**
   * Poll for recent contract events using cursor-based pagination.
   *
   * @param cursor - Optional cursor for pagination (from previous response)
   * @returns Events response containing events and next cursor
   */
  async pollEvents(cursor?: string): Promise<{ events: unknown[]; cursor: string }> {
    const req: Record<string, unknown> = {
      filters: [{ contractIds: [this.contractId], type: 'contract' }],
    };
    if (cursor) req.cursor = cursor;
    else req.startLedger = 0;
    const response = await this.server.getEvents(
      req as Parameters<typeof this.server.getEvents>[0],
    );
    return {
      events: response.events,
      cursor: response.cursor,
    };
  }

  /**
   * Update the token symbol. Admin-only.
   *
   * @param newSymbol - The new token symbol
   * @param source    - Admin keypair
   */
  async updateSymbol(newSymbol: string, source?: Keypair): Promise<TransactionResult> {
    return this.invokeContract('update_symbol', [stringToScVal(newSymbol)], source);
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Internal helper to execute a task with retries.
   */
  private async withRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: unknown;
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
      } catch (error: unknown) {
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
    source?: Keypair,
  ): Promise<TransactionResult> {
    return this.withRetry(async () => {
      try {
        // If an explicit Keypair is provided, use the existing signed builder
        if (source) {
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
              hash: (response as unknown as { hash: string }).hash,
              returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
            };
          }

          return {
            success: false,
            hash: (response as unknown as { hash: string }).hash,
          };
        }

        // Otherwise, attempt to use the configured wallet adapter
        if (!this.walletAdapter) throw new Error('No signing source provided');
        if (!this.walletAdapter.connected || !this.walletAdapter.publicKey)
          throw new Error('Wallet adapter not connected');

        const unsignedXdr = await buildUnsignedTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          this.walletAdapter.publicKey,
        );

        const signedXdr = await this.walletAdapter.signTransaction(unsignedXdr);

        const response = await submitTransaction(this.rpcUrl, signedXdr);

        if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          return {
            success: true,
            hash: (response as unknown as { hash: string }).hash,
            returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
          };
        }

        return {
          success: false,
          hash: (response as unknown as { hash: string }).hash,
        };
      } catch (error: unknown) {
        // Don't retry on simulation errors (usually logic errors)
        if (error instanceof SimulationError) throw error;
        throw error;
      }
    });
  }

  /**
   * Waits for a submitted transaction response and unwraps the final SDK result.
   */
  private async unwrapTransactionResponse(
    responsePromise: Promise<SorobanRpc.Api.GetTransactionResponse>,
  ): Promise<TransactionResult> {
    const response = await responsePromise;

    if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return {
        success: true,
        hash: (response as unknown as { hash: string }).hash,
        returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
      };
    }

    return {
      success: false,
      hash: (response as unknown as { hash: string }).hash,
    };
  }
}
