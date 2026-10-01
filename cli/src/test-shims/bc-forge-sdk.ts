// SPDX-License-Identifier: MIT
/** Test/build shim so CLI unit tests do not hit live Soroban RPC. */
export interface TransactionResult {
  success: boolean;
  hash: string;
  returnValue?: unknown;
}

export enum Role {
  Admin = "Admin",
  SuperAdmin = "SuperAdmin",
  Minter = "Minter",
  Pauser = "Pauser",
}

export class bcForgeClient {
  constructor(_config: {
    rpcUrl: string;
    networkPassphrase: string;
    contractId: string;
  }) {}

  async initialize(
    _admin: string,
    _decimals: number,
    _name: string,
    _symbol: string,
    _source: unknown
  ): Promise<{ success: boolean; hash: string }> {
    return { success: true, hash: "mock-init-tx" };
  }

  async verifySuperAdmin(_address: string): Promise<boolean> {
    return true;
  }

  async getAdmin(): Promise<string> {
    return "";
  }

  async setAdminContract(
    _adminContractId: string,
    _source: unknown
  ): Promise<{ success: boolean; hash: string }> {
    return { success: true, hash: "mock-set-admin-contract" };
  }

  async setDependentToken(
    _tokenContractId: string,
    _source: unknown
  ): Promise<{ success: boolean; hash: string }> {
    return { success: true, hash: "mock-set-dependent-token" };
  }

  async pause(_source?: unknown): Promise<TransactionResult> {
    return { success: true, hash: "mock-pause" };
  }

  async unpause(_source?: unknown): Promise<TransactionResult> {
    return { success: true, hash: "mock-unpause" };
  }

  async buildPauseTx(_sourcePublicKey: string): Promise<string> {
    return "mock-unsigned-pause";
  }

  async buildUnpauseTx(_sourcePublicKey: string): Promise<string> {
    return "mock-unsigned-unpause";
  }

  async submitSignedTransaction(_txXdr: string): Promise<TransactionResult> {
    return { success: true, hash: "mock-submitted" };
  }

  async createProposal(
    _creator: string,
    _description: string,
    _source?: unknown
  ): Promise<TransactionResult> {
    return { success: true, hash: "mock-propose", returnValue: 1n };
  }

  async approveProposal(
    _admin: string,
    _proposalId: bigint,
    _source?: unknown
  ): Promise<TransactionResult> {
    return { success: true, hash: "mock-approve" };
  }

  async executeUpgrade(
    _executor: string,
    _proposalId: bigint,
    _wasmHash: string,
    _source?: unknown
  ): Promise<TransactionResult> {
    return { success: true, hash: "mock-execute-upgrade" };
  }

  async buildCreateProposalTx(
    _creator: string,
    _description: string,
    _sourcePublicKey: string
  ): Promise<string> {
    return "mock-unsigned-propose";
  }

  async buildApproveProposalTx(
    _admin: string,
    _proposalId: bigint,
    _sourcePublicKey: string
  ): Promise<string> {
    return "mock-unsigned-approve";
  }

  async buildExecuteUpgradeTx(
    _executor: string,
    _proposalId: bigint,
    _wasmHash: string,
    _sourcePublicKey: string
  ): Promise<string> {
    return "mock-unsigned-execute";
  }

  async execute(signedXdr: string): Promise<TransactionResult> {
    return this.submitSignedTransaction(signedXdr);
  }
}
