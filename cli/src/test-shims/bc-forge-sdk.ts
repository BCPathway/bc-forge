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
}
