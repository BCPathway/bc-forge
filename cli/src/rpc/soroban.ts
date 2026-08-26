import {
  rpc as SorobanRpcNs,
  Contract,
  TransactionBuilder,
  Keypair,
  xdr,
  Address,
  nativeToScVal,
  Account,
} from "@stellar/stellar-sdk";

export interface SorobanRpcConfig {
  rpcUrl: string;
  networkPassphrase: string;
  contractId: string;
}

export interface TxResult {
  hash: string;
  success: boolean;
  resultXdr?: string;
  error?: string;
}

/**
 * Abstraction over Soroban RPC calls, allowing test/mock injection.
 * Default implementation uses the real Stellar SDK.
 */
export class SorobanRpc {
  protected config: SorobanRpcConfig;
  protected server: SorobanRpcNs.Server;

  constructor(config: SorobanRpcConfig) {
    this.config = config;
    this.server = new SorobanRpcNs.Server(config.rpcUrl, {
      allowHttp: config.rpcUrl.startsWith("http://"),
    });
  }

  getServer(): SorobanRpcNs.Server {
    return this.server;
  }

  getConfig(): SorobanRpcConfig {
    return { ...this.config };
  }

  /**
   * Invoke a contract method.
   */
  async invoke(
    method: string,
    args: xdr.ScVal[],
    sourceSecret: string
  ): Promise<TxResult> {
    const sourceKeypair = Keypair.fromSecret(sourceSecret);
    const sourcePublicKey = sourceKeypair.publicKey();
    const sourceAccount = await this.server.getAccount(sourcePublicKey);
    const contract = new Contract(this.config.contractId);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: "100",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const result = await this.server.sendTransaction(tx);

    if (result.status === "ERROR") {
      return {
        hash: result.hash,
        success: false,
        error: JSON.stringify(result.errorResult),
      };
    }

    const confirmed = await this.pollTx(result.hash);
    return {
      hash: result.hash,
      success: true,
      resultXdr: confirmed,
    };
  }

  /**
   * Simulate a contract method call without submitting.
   */
  async simulate(
    method: string,
    args: xdr.ScVal[],
    sourcePublicKey?: string
  ): Promise<any> {
    const account = sourcePublicKey
      ? await this.server.getAccount(sourcePublicKey)
      : new Account(
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          "0"
        );

    const contract = new Contract(this.config.contractId);
    const tx = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    return this.server.simulateTransaction(tx);
  }

  /**
   * Poll transaction status until confirmed or errored.
   */
  protected async pollTx(
    txHash: string,
    maxAttempts = 30,
    intervalMs = 2000
  ): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      const tx = await this.server.getTransaction(txHash);
      if (tx.status === "SUCCESS") {
        return typeof tx.resultXdr === 'string' ? tx.resultXdr : String(tx.resultXdr);
      }
      if (tx.status === "FAILED") {
        throw new Error(`Transaction ${txHash} failed: ${JSON.stringify(tx.resultXdr)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Transaction ${txHash} did not confirm within ${maxAttempts * intervalMs}ms`
    );
  }
}
