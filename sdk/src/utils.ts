/**
 * @bc-forge/sdk — Utility functions for Soroban transaction building and submission.
 */

import {
  SorobanRpc,
  TransactionBuilder,
  Networks,
  xdr,
  Address,
  nativeToScVal,
  scValToNative as sdkScValToNative,
  Contract,
  Keypair,
} from '@stellar/stellar-sdk';

/**
 * Builds an `invokeHostFunction` transaction for a Soroban contract call.
 *
 * @param rpcUrl           - The Soroban RPC endpoint URL.
 * @param networkPassphrase - The Stellar network passphrase.
 * @param contractId       - The deployed contract ID (C... address).
 * @param method           - The contract function name to invoke.
 * @param args             - Array of xdr.ScVal arguments.
 * @param sourceKeypair    - The keypair signing the transaction.
 * @returns The assembled and signed transaction XDR string.
 */
export async function buildInvokeTransaction(
  rpcUrl: string,
  networkPassphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceKeypair: Keypair,
): Promise<string> {
  const server = new SorobanRpc.Server(rpcUrl);
  const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(sourceAccount, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get the assembled transaction
  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simulated).build();
  assembled.sign(sourceKeypair);

  return assembled.toXDR();
}

/**
 * Submits a signed transaction XDR to the Soroban RPC and waits for confirmation.
 *
 * @param rpcUrl  - The Soroban RPC endpoint URL.
 * @param txXdr   - The signed transaction in XDR format.
 * @returns The transaction result from the ledger.
 */
export async function submitTransaction(
  rpcUrl: string,
  txXdr: string,
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  const server = new SorobanRpc.Server(rpcUrl);
  const tx = TransactionBuilder.fromXDR(txXdr, Networks.TESTNET);

  const sendResponse = await server.sendTransaction(tx);

  if (sendResponse.status === 'ERROR') {
    throw new Error(`Transaction submission failed: ${sendResponse.errorResult}`);
  }

  // Poll for completion
  let getResponse: SorobanRpc.Api.GetTransactionResponse;
  let attempts = 0;
  const maxAttempts = 30;

  do {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    getResponse = await server.getTransaction(sendResponse.hash);
    attempts++;
  } while (
    getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
    attempts < maxAttempts
  );

  if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    throw new Error('Transaction not found after maximum polling attempts');
  }

  return getResponse;
}

/**
 * Converts a Stellar address string to an ScVal for contract invocation.
 */
export function addressToScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

/**
 * Converts a native i128 bigint to an ScVal.
 */
export function i128ToScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

/**
 * Converts a native string to an ScVal.
 */
export function stringToScVal(value: string): xdr.ScVal {
  return nativeToScVal(value, { type: 'string' });
}

/**
 * Converts a native u32 to an ScVal.
 */
export function u32ToScVal(value: number): xdr.ScVal {
  return nativeToScVal(value, { type: 'u32' });
}

/**
 * Converts an ScVal to a native JS type.
 */
export function scValToNative(scVal: xdr.ScVal): any {
  return sdkScValToNative(scVal);
}
