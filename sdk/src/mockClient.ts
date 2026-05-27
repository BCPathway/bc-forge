/**
 * MockBcForgeClient — In-memory mock for bcForgeClient
 *
 * Allows frontend devs to test logic without a live Soroban RPC.
 */
import type { BatchMintRecipient, bcForgeClientConfig, TransactionResult } from './client';

interface AccountState {
  balance: bigint;
  allowances: Record<string, bigint>;
}

/**
 * `MockBcForgeClient` — lightweight in-memory stand-in for `bcForgeClient`.
 *
 * Use this class in unit tests and UI development where a live Soroban RPC
 * and on-chain contract are not available. The mock implements the same
 * high-level public methods as `bcForgeClient` but operates entirely in
 * memory and returns deterministic `TransactionResult` objects.
 */
export class MockBcForgeClient {
  private accounts: Record<string, AccountState> = {};
  private totalSupply: bigint = 0n;
  private name: string = 'MockToken';
  private symbol: string = 'MOCK';
  private decimals: number = 7;

  /**
   * Creates a new in-memory MockBcForgeClient.
   *
   * @param _config - The client configuration (kept for API parity with bcForgeClient).
   */
  constructor(_config: bcForgeClientConfig) {}

  /**
   * Returns the token balance for the given address from the in-memory store.
   *
   * @param address - Stellar public key (G... address) to query.
   * @returns Promise that resolves to the account balance as a bigint.
   */
  async getBalance(address: string): Promise<bigint> {
    return this.accounts[address]?.balance ?? 0n;
  }

  /**
   * Returns the total token supply tracked by the mock client.
   *
   * @returns Promise that resolves to the total supply as a bigint.
   */
  async getTotalSupply(): Promise<bigint> {
    return this.totalSupply;
  }

  /**
   * Returns the human-readable token name configured in the mock.
   *
   * @returns Promise that resolves to the token name string.
   */
  async getName(): Promise<string> {
    return this.name;
  }

  /**
   * Returns the token ticker symbol configured in the mock.
   *
   * @returns Promise that resolves to the token symbol string.
   */
  async getSymbol(): Promise<string> {
    return this.symbol;
  }

  /**
   * Returns the number of decimal places for the token.
   *
   * @returns Promise that resolves to the decimals as a number.
   */
  async getDecimals(): Promise<number> {
    return this.decimals;
  }

  /**
   * Returns the current allowance from `owner` to `spender`.
   *
   * @param owner - Owner Stellar public key (G... address).
   * @param spender - Spender Stellar public key (G... address).
   * @returns Promise that resolves to the allowance as a bigint.
   */
  async getAllowance(owner: string, spender: string): Promise<bigint> {
    return this.accounts[owner]?.allowances[spender] ?? 0n;
  }

  /**
   * Mints tokens to the specified address in the mock ledger.
   *
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Amount to mint as bigint.
   * @returns Promise resolving to a TransactionResult indicating success.
   */
  async mint(to: string, amount: bigint): Promise<TransactionResult> {
    if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
    this.accounts[to].balance += amount;
    this.totalSupply += amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  /**
   * Batch mint tokens to multiple recipients.
   *
   * Performs basic validation on input and updates the in-memory ledger.
   *
   * @param recipients - Array of `{ to, amount }` objects describing mint targets.
   * @returns Promise resolving to a TransactionResult indicating success or failure.
   */
  async batchMint(recipients: BatchMintRecipient[]): Promise<TransactionResult> {
    if (recipients.length === 0) {
      return { success: false, hash: 'mock-hash', returnValue: 'Recipients list cannot be empty' };
    }
    if (recipients.some(({ amount }) => amount <= 0n)) {
      return { success: false, hash: 'mock-hash', returnValue: 'Mint amount must be positive' };
    }

    for (const { to, amount } of recipients) {
      if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
      this.accounts[to].balance += amount;
      this.totalSupply += amount;
    }
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  /**
   * Transfers tokens between two in-memory accounts.
   *
   * @param from - Sender Stellar public key (G... address).
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Amount to transfer as bigint.
   * @returns Promise resolving to a TransactionResult indicating success or failure.
   */
  async transfer(from: string, to: string, amount: bigint): Promise<TransactionResult> {
    if ((this.accounts[from]?.balance ?? 0n) < amount) {
      return { success: false, hash: 'mock-hash', returnValue: 'Insufficient balance' };
    }
    if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
    this.accounts[from].balance -= amount;
    this.accounts[to].balance += amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  /**
   * Sets an allowance from `owner` to `spender` in the mock ledger.
   *
   * @param owner - Owner Stellar public key (G... address).
   * @param spender - Spender Stellar public key (G... address).
   * @param amount - Allowance amount as bigint.
   * @returns Promise resolving to a TransactionResult indicating success.
   */
  async approve(owner: string, spender: string, amount: bigint): Promise<TransactionResult> {
    if (!this.accounts[owner]) this.accounts[owner] = { balance: 0n, allowances: {} };
    this.accounts[owner].allowances[spender] = amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  /**
   * Transfers tokens on behalf of an owner using an allowance.
   *
   * @param owner - Owner Stellar public key (G... address).
   * @param spender - Spender Stellar public key (G... address) performing the transfer.
   * @param to - Recipient Stellar public key (G... address).
   * @param amount - Amount to transfer as bigint.
   * @returns Promise resolving to a TransactionResult indicating success or failure.
   */
  async transferFrom(
    owner: string,
    spender: string,
    to: string,
    amount: bigint,
  ): Promise<TransactionResult> {
    const allowance = this.accounts[owner]?.allowances[spender] ?? 0n;
    if (allowance < amount) {
      return { success: false, hash: 'mock-hash', returnValue: 'Insufficient allowance' };
    }
    if ((this.accounts[owner]?.balance ?? 0n) < amount) {
      return { success: false, hash: 'mock-hash', returnValue: 'Insufficient balance' };
    }
    if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
    this.accounts[owner].balance -= amount;
    this.accounts[to].balance += amount;
    this.accounts[owner].allowances[spender] -= amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }
}
