/**
 * MockBcForgeClient — In-memory mock for bcForgeClient
 *
 * Allows frontend devs to test logic without a live Soroban RPC.
 */
import { bcForgeClientConfig, TransactionResult } from './client';

interface AccountState {
  balance: bigint;
  allowances: Record<string, bigint>;
}

export class MockBcForgeClient {
  private accounts: Record<string, AccountState> = {};
  private totalSupply: bigint = 0n;
  private name: string = 'MockToken';
  private symbol: string = 'MOCK';
  private decimals: number = 7;

  constructor(config: bcForgeClientConfig) {}

  async getBalance(address: string): Promise<bigint> {
    return this.accounts[address]?.balance ?? 0n;
  }

  async getTotalSupply(): Promise<bigint> {
    return this.totalSupply;
  }

  async getName(): Promise<string> {
    return this.name;
  }

  async getSymbol(): Promise<string> {
    return this.symbol;
  }

  async getDecimals(): Promise<number> {
    return this.decimals;
  }

  async getAllowance(owner: string, spender: string): Promise<bigint> {
    return this.accounts[owner]?.allowances[spender] ?? 0n;
  }

  async mint(to: string, amount: bigint): Promise<TransactionResult> {
    if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
    this.accounts[to].balance += amount;
    this.totalSupply += amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async transfer(from: string, to: string, amount: bigint): Promise<TransactionResult> {
    if ((this.accounts[from]?.balance ?? 0n) < amount) {
      return { success: false, hash: 'mock-hash', returnValue: 'Insufficient balance' };
    }
    if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
    this.accounts[from].balance -= amount;
    this.accounts[to].balance += amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async approve(owner: string, spender: string, amount: bigint): Promise<TransactionResult> {
    if (!this.accounts[owner]) this.accounts[owner] = { balance: 0n, allowances: {} };
    this.accounts[owner].allowances[spender] = amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async transferFrom(owner: string, spender: string, to: string, amount: bigint): Promise<TransactionResult> {
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
