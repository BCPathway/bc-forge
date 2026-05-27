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

export class MockBcForgeClient {
  private accounts: Record<string, AccountState> = {};
  private totalSupply: bigint = 0n;
  private name: string = 'MockToken';
  private symbol: string = 'MOCK';
  private decimals: number = 7;

  constructor(_config: bcForgeClientConfig) {}

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

  // ─── Offline Builders & Submit Stubs ──────────────────────────────────────

  async buildUnsignedTx(method: string, _args: any[], _sourcePublicKey: string): Promise<string> {
    return `mock-unsigned-xdr-for-${method}`;
  }

  async submitTx(_txXdr: string): Promise<TransactionResult> {
    return { success: true, hash: 'mock-hash', returnValue: null };
  }

  signTx(txXdr: string, _keypair: any): string {
    return `${txXdr}-signed`;
  }

  async buildInitializeTx(
    _admin: string,
    _decimals: number,
    _name: string,
    _symbol: string,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('initialize', [], sourcePublicKey);
  }

  async buildMintTx(_to: string, _amount: bigint, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('mint', [], sourcePublicKey);
  }

  async buildBatchMintTx(
    _recipients: BatchMintRecipient[],
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('batch_mint', [], sourcePublicKey);
  }

  async buildTransferTx(
    _from: string,
    _to: string,
    _amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('transfer', [], sourcePublicKey);
  }

  async buildApproveTx(
    _from: string,
    _spender: string,
    _amount: bigint,
    _exp: number,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('approve', [], sourcePublicKey);
  }

  async buildBurnTx(_from: string, _amount: bigint, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('burn', [], sourcePublicKey);
  }

  async buildTransferOwnershipTx(_newAdmin: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('transfer_ownership', [], sourcePublicKey);
  }

  async buildPauseTx(sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('pause', [], sourcePublicKey);
  }

  async buildUnpauseTx(sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('unpause', [], sourcePublicKey);
  }

  async buildSetAdminPoolTx(
    _pool: string[],
    _threshold: number,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('set_admin_pool', [], sourcePublicKey);
  }

  async buildUpgradeTx(_newWasmHash: string | Buffer, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('upgrade', [], sourcePublicKey);
  }

  async buildProposeActionTx(
    _admin: string,
    _action: any,
    _description: string,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('propose_action', [], sourcePublicKey);
  }

  async buildApproveProposalTx(
    _admin: string,
    _proposalId: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('approve_proposal', [], sourcePublicKey);
  }

  async buildExecuteProposalTx(_proposalId: bigint, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('execute_proposal', [], sourcePublicKey);
  }

  async buildSetClawbackAdminTx(_admin: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('set_clawback_admin', [], sourcePublicKey);
  }

  async buildUpdateNameTx(_newName: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('update_name', [], sourcePublicKey);
  }

  async buildClawbackTx(
    _from: string,
    _to: string,
    _amount: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('clawback', [], sourcePublicKey);
  }

  async buildLockTokensTx(
    _user: string,
    _amount: bigint,
    _unlockTime: bigint,
    sourcePublicKey: string,
  ): Promise<string> {
    return this.buildUnsignedTx('lock_tokens', [], sourcePublicKey);
  }

  async buildWithdrawLockedTx(_user: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('withdraw_locked', [], sourcePublicKey);
  }

  async buildUpdateSymbolTx(_newSymbol: string, sourcePublicKey: string): Promise<string> {
    return this.buildUnsignedTx('update_symbol', [], sourcePublicKey);
  }
}
