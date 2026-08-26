/**
 * MockBcForgeClient — In-memory mock for bcForgeClient
 *
 * Allows frontend devs to test logic without a live Soroban RPC.
 */
import { Role, type BatchMintRecipient, type bcForgeClientConfig, type TransactionResult } from './client';
import { formatAtomicAmount } from './utils';

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
  private adminAddress: string = 'GADMIN0000000000000000000000000000000000000000000000000000';
  private roles: Map<string, Set<string>> = new Map(); // address -> Set of roles
  private linkedContracts: Record<string, string> = {};

  constructor(_config: bcForgeClientConfig) {}

  async getBalance(address: string): Promise<string> {
    return formatAtomicAmount(this.accounts[address]?.balance ?? 0n, this.decimals);
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

  async getAdmin(): Promise<string> {
    return this.adminAddress;
  }

  async setAdmin(admin: string): Promise<TransactionResult> {
    this.adminAddress = admin;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async hasRole(role: Role, address: string): Promise<boolean> {
    if (this.adminAddress === address) return true;
    const userRoles = this.roles.get(address);
    return userRoles ? userRoles.has(role) : false;
  }

  async verifySuperAdmin(address: string): Promise<boolean> {
    return this.hasRole(Role.SuperAdmin, address);
  }

  async grantRole(role: Role, address: string): Promise<TransactionResult> {
    if (!this.roles.has(address)) {
      this.roles.set(address, new Set());
    }
    this.roles.get(address)!.add(role);
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async revokeRole(role: Role, address: string): Promise<TransactionResult> {
    if (this.roles.has(address)) {
      this.roles.get(address)!.delete(role);
    }
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async setAdminContract(adminContractId: string): Promise<TransactionResult> {
    this.linkedContracts['admin'] = adminContractId;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async setDependentToken(tokenContractId: string): Promise<TransactionResult> {
    this.linkedContracts['token'] = tokenContractId;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  getLinkedContracts(): Record<string, string> {
    return { ...this.linkedContracts };
  }

  async mint(from: string, to: string, amount: bigint): Promise<TransactionResult> {
    if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
    this.accounts[to].balance += amount;
    this.totalSupply += amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async batchMint(from: string, recipients: BatchMintRecipient[]): Promise<TransactionResult> {
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

  async batchTransfer(from: string, recipients: BatchMintRecipient[]): Promise<TransactionResult> {
    if ((this.accounts[from]?.balance ?? 0n) < recipients.reduce((sum, r) => sum + r.amount, 0n)) {
      return { success: false, hash: 'mock-hash', returnValue: 'Insufficient balance' };
    }
    for (const { to, amount } of recipients) {
      if (!this.accounts[to]) this.accounts[to] = { balance: 0n, allowances: {} };
      this.accounts[from].balance -= amount;
      this.accounts[to].balance += amount;
    }
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async updateName(newName: string): Promise<TransactionResult> {
    this.name = newName;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async updateSymbol(newSymbol: string): Promise<TransactionResult> {
    this.symbol = newSymbol;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async grantMinter(address: string): Promise<TransactionResult> {
    return this.grantRole(Role.Minter, address);
  }

  async revokeMinter(address: string): Promise<TransactionResult> {
    return this.revokeRole(Role.Minter, address);
  }

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
