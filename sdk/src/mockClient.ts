/**
 * MockBcForgeClient — In-memory mock for bcForgeClient
 *
 * Allows frontend devs to test logic without a live Soroban RPC.
 */
import type {
  BatchMintRecipient,
  bcForgeClientConfig,
  RbacInitResult,
  TransactionResult,
} from './client';
import { formatAtomicAmount } from './utils';

interface AccountState {
  balance: bigint;
  allowances: Record<string, bigint>;
}

export class MockBcForgeClient {
  private accounts: Record<string, AccountState> = {};
  private roles: Record<string, Set<string>> = {};
  private totalSupply: bigint = 0n;
  private name: string = 'MockToken';
  private symbol: string = 'MOCK';
  private decimals: number = 7;

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

  async grantMinter(_address: string): Promise<TransactionResult> {
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async revokeMinter(_address: string): Promise<TransactionResult> {
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async grantSuperAdmin(address: string): Promise<TransactionResult> {
    if (!this.roles[address]) this.roles[address] = new Set();
    this.roles[address].add('SuperAdmin');
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async revokeSuperAdmin(address: string): Promise<TransactionResult> {
    if (!this.roles[address]?.has('SuperAdmin')) {
      return { success: false, hash: 'mock-hash', returnValue: 'SuperAdmin role not held' };
    }
    this.roles[address].delete('SuperAdmin');
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async hasRole(role: string, address: string): Promise<boolean> {
    return this.roles[address]?.has(role) ?? false;
  }

  async initRbac(superAdmin: string): Promise<RbacInitResult> {
    const grant = await this.grantSuperAdmin(superAdmin);
    return {
      migrate: { success: true, hash: 'mock-hash', returnValue: null },
      grant,
    };
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

export class MockVaultClient {
  private shareBalances: Record<string, bigint> = {};
  private allowances: Record<string, Record<string, bigint>> = {};
  private totalShares: bigint = 0n;
  private totalAssetsAmount: bigint = 0n;
  private pendingRewardsAmount: bigint = 0n;
  private underlyingTokenAddress: string =
    'CDUMMYUNDERLYINGTOKENADDRESS0000000000000000000000000000';
  private name: string = 'Mock Vault Share';
  private symbol: string = 'mvSHARE';
  private decimals: number = 7;

  constructor(_config?: { rpcUrl?: string; networkPassphrase?: string; contractId?: string }) {}

  async getBalance(address: string): Promise<bigint> {
    return this.shareBalances[address] ?? 0n;
  }

  async getShareBalance(address: string): Promise<bigint> {
    return this.shareBalances[address] ?? 0n;
  }

  async getTotalSupply(): Promise<bigint> {
    return this.totalShares;
  }

  async getTotalAssets(): Promise<bigint> {
    return this.totalAssetsAmount;
  }

  async getPendingRewards(): Promise<bigint> {
    return this.pendingRewardsAmount;
  }

  async calculateSharePrice(): Promise<bigint> {
    if (this.totalShares === 0n) {
      throw new Error('ZeroShares: No shares outstanding');
    }
    return this.totalAssetsAmount / this.totalShares;
  }

  async calculateRewards(userShares: bigint): Promise<bigint> {
    if (userShares < 0n) {
      throw new Error('InvalidAmount: Negative shares');
    }
    if (this.totalShares === 0n) {
      throw new Error('ZeroShares: No shares outstanding');
    }
    return (userShares * this.totalAssetsAmount) / this.totalShares;
  }

  async getUnderlyingToken(): Promise<string> {
    return this.underlyingTokenAddress;
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
    return this.allowances[owner]?.[spender] ?? 0n;
  }

  async deposit(
    caller: string,
    amount: bigint,
    _source?: unknown,
    minSharesOut: bigint = 0n,
  ): Promise<TransactionResult> {
    if (amount <= 0n) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'InvalidAmount: Amount must be positive',
      };
    }

    const sharesOut =
      this.totalShares === 0n ? amount : (amount * this.totalShares) / this.totalAssetsAmount;

    if (sharesOut <= 0n) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'InvalidAmount: Calculated shares are zero',
      };
    }

    if (sharesOut < minSharesOut) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'SlippageExceeded: Minted shares less than minSharesOut',
      };
    }

    this.shareBalances[caller] = (this.shareBalances[caller] ?? 0n) + sharesOut;
    this.totalShares += sharesOut;
    this.totalAssetsAmount += amount;

    return { success: true, hash: 'mock-hash', returnValue: sharesOut };
  }

  async withdraw(
    caller: string,
    shares: bigint,
    _source?: unknown,
    minTokensOut: bigint = 0n,
  ): Promise<TransactionResult> {
    if (shares <= 0n) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'InvalidAmount: Shares must be positive',
      };
    }

    const userBalance = this.shareBalances[caller] ?? 0n;
    if (userBalance < shares) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'InsufficientBalance: Not enough shares',
      };
    }

    if (this.totalShares === 0n) {
      return { success: false, hash: 'mock-hash', returnValue: 'ZeroShares: No shares in vault' };
    }

    const tokensOut = (shares * this.totalAssetsAmount) / this.totalShares;

    if (tokensOut <= 0n) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'InvalidAmount: Payout rounds down to zero',
      };
    }

    if (tokensOut < minTokensOut) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'SlippageExceeded: Returned tokens less than minTokensOut',
      };
    }

    this.shareBalances[caller] = userBalance - shares;
    this.totalShares -= shares;
    this.totalAssetsAmount -= tokensOut;

    return { success: true, hash: 'mock-hash', returnValue: tokensOut };
  }

  async distributeRewards(
    _caller: string,
    amount: bigint,
    _source?: unknown,
  ): Promise<TransactionResult> {
    if (amount <= 0n) {
      return {
        success: false,
        hash: 'mock-hash',
        returnValue: 'InvalidAmount: Reward amount must be positive',
      };
    }
    this.totalAssetsAmount += amount;
    this.pendingRewardsAmount += amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async compound(_caller: string, _source?: unknown): Promise<TransactionResult> {
    this.pendingRewardsAmount = 0n;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async compoundFees(caller: string, source?: unknown): Promise<TransactionResult> {
    return this.compound(caller, source);
  }

  async transfer(
    from: string,
    to: string,
    amount: bigint,
    _source?: unknown,
  ): Promise<TransactionResult> {
    const fromBalance = this.shareBalances[from] ?? 0n;
    if (fromBalance < amount) {
      return { success: false, hash: 'mock-hash', returnValue: 'InsufficientBalance' };
    }
    this.shareBalances[from] = fromBalance - amount;
    this.shareBalances[to] = (this.shareBalances[to] ?? 0n) + amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  async approve(
    from: string,
    spender: string,
    amount: bigint,
    _exp?: number,
    _source?: unknown,
  ): Promise<TransactionResult> {
    if (!this.allowances[from]) this.allowances[from] = {};
    this.allowances[from][spender] = amount;
    return { success: true, hash: 'mock-hash', returnValue: null };
  }
}
