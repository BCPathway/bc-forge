/** Test/build shim so CLI unit tests do not hit live Soroban RPC. */
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
}
