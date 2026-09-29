// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Utility functions for Soroban transaction building and submission.
 */

import {
  rpc as SorobanRpc,
  TransactionBuilder,
  Networks,
  xdr,
  Account,
  Address,
  nativeToScVal,
  scValToNative as sdkScValToNative,
  Contract,
  Keypair,
} from '@stellar/stellar-sdk';

import {
  SimulationError,
  TransactionSubmissionError,
  TransactionTimeoutError,
  ContractError,
  parseContractError,
} from './errors';

export interface SubmitTransactionOptions {
  maxAttempts?: number;
  maxFeeCap?: bigint | number | string;
  sourceKeypair?: Keypair;
  networkPassphrase?: string;
  contractId?: string;
  method?: string;
  args?: xdr.ScVal[];
}

/**
 * Builds an `invokeHostFunction` transaction for a Soroban contract call.
 *
 * @param rpcUrl           - The Soroban RPC endpoint URL.
 * @param networkPassphrase - The Stellar network passphrase.
 * @param contractId       - The deployed contract ID (C... address).
 * @param method           - The contract function name to invoke.
 * @param args             - Array of xdr.ScVal arguments.
 * @param sourceKeypair    - The keypair signing the transaction.
 * @param options          - Optional options including fee override.
 * @returns The assembled and signed transaction XDR string.
 */
export async function buildInvokeTransaction(
  rpcUrl: string,
  networkPassphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceKeypair: Keypair,
  options?: { fee?: string | number | bigint },
): Promise<string> {
  const server = new SorobanRpc.Server(rpcUrl);
  const sourceAccount = await server.getAccount(sourceKeypair.publicKey());

  const contract = new Contract(contractId);
  const feeStr = options?.fee ? options.fee.toString() : '100';

  const tx = new TransactionBuilder(sourceAccount, {
    fee: feeStr,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get the assembled transaction
  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    const parsed = parseContractError(simulated.error, method);
    if (parsed) {
      throw parsed;
    }
    throw new SimulationError(`Contract simulation failed: ${simulated.error}`, simulated.error);
  }

  const assembled = SorobanRpc.assembleTransaction(tx, simulated).build();
  assembled.sign(sourceKeypair);

  return assembled.toXDR();
}

/**
 * Submits a signed transaction XDR to the Soroban RPC and waits for confirmation.
 * Automatically retries transient sequence and fee errors up to maxAttempts.
 *
 * @param rpcUrl  - The Soroban RPC endpoint URL.
 * @param txXdr   - The signed transaction in XDR format.
 * @param options - Options including maxAttempts, maxFeeCap, and rebuild context.
 * @returns The transaction result from the ledger.
 */
export async function submitTransaction(
  rpcUrl: string,
  txXdr: string,
  options: SubmitTransactionOptions = {},
): Promise<SorobanRpc.Api.GetTransactionResponse> {
  const server = new SorobanRpc.Server(rpcUrl);
  const maxAttempts = options.maxAttempts ?? 3;
  const maxFeeCap = options.maxFeeCap !== undefined ? BigInt(options.maxFeeCap) : 10000000n;
  const networkPassphrase = options.networkPassphrase || Networks.TESTNET;

  let currentXdr = txXdr;
  let currentFee = 100n;

  try {
    const parsedTx = TransactionBuilder.fromXDR(currentXdr, networkPassphrase);
    currentFee = BigInt(parsedTx.fee);
  } catch {
    // ignore
  }

  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt++;

    try {
      let sendResponse: SorobanRpc.Api.SendTransactionResponse;
      try {
        const tx = TransactionBuilder.fromXDR(currentXdr, networkPassphrase);
        sendResponse = await server.sendTransaction(tx);
      } catch {
        sendResponse = await server.sendTransaction({ toXDR: () => currentXdr } as any);
      }

      if (sendResponse.status === 'ERROR') {
        const errorStr = `${sendResponse.errorResult || ''} ${(sendResponse as any).errorResultXdr || ''}`;

        // Check if contract logic failed (TX_FAILED / panic) -> DO NOT RETRY
        if (
          errorStr.includes('txFAILED') ||
          errorStr.includes('txfailed') ||
          errorStr.includes('ContractError') ||
          errorStr.includes('Error(Contract')
        ) {
          const parsed = parseContractError(errorStr, options.method);
          if (parsed) {
            throw parsed;
          }
          throw new TransactionSubmissionError(
            `Transaction submission failed: ${sendResponse.errorResult || errorStr}`,
            sendResponse.hash,
          );
        }

        // Check sequence error (txBAD_SEQ)
        if (
          errorStr.includes('txBAD_SEQ') ||
          errorStr.includes('txbad_seq') ||
          errorStr.includes('BAD_SEQ') ||
          errorStr.includes('bad_seq')
        ) {
          if (
            attempt < maxAttempts &&
            options.sourceKeypair &&
            options.contractId &&
            options.method &&
            options.args
          ) {
            currentXdr = await buildInvokeTransaction(
              rpcUrl,
              networkPassphrase,
              options.contractId,
              options.method,
              options.args,
              options.sourceKeypair,
              { fee: currentFee },
            );
            continue;
          }
          throw new TransactionSubmissionError(
            `Transaction submission failed (sequence error): ${sendResponse.errorResult || errorStr}`,
            sendResponse.hash,
          );
        }

        // Check fee error (txINSUFFICIENT_FEE)
        if (
          errorStr.includes('txINSUFFICIENT_FEE') ||
          errorStr.includes('txinsufficient_fee') ||
          errorStr.includes('INSUFFICIENT_FEE') ||
          errorStr.includes('insufficient_fee')
        ) {
          if (
            attempt < maxAttempts &&
            currentFee < maxFeeCap &&
            options.sourceKeypair &&
            options.contractId &&
            options.method &&
            options.args
          ) {
            const bumpedFee = currentFee * 2n < maxFeeCap ? currentFee * 2n : maxFeeCap;
            if (bumpedFee > currentFee) {
              currentFee = bumpedFee;
              currentXdr = await buildInvokeTransaction(
                rpcUrl,
                networkPassphrase,
                options.contractId,
                options.method,
                options.args,
                options.sourceKeypair,
                { fee: currentFee },
              );
              continue;
            }
          }
          throw new TransactionSubmissionError(
            `Transaction submission failed (fee error): ${sendResponse.errorResult || errorStr}`,
            sendResponse.hash,
          );
        }

        throw new TransactionSubmissionError(
          `Transaction submission failed: ${sendResponse.errorResult || errorStr}`,
          sendResponse.hash,
        );
      }

      // Poll for completion
      let getResponse: SorobanRpc.Api.GetTransactionResponse;
      let pollAttempts = 0;
      const maxPollAttempts = 30;

      do {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        getResponse = await server.getTransaction(sendResponse.hash);
        pollAttempts++;
      } while (
        getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND &&
        pollAttempts < maxPollAttempts
      );

      if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
        throw new TransactionTimeoutError(
          'Transaction not found after maximum polling attempts',
          sendResponse.hash,
        );
      }

      if (getResponse.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
        const errorStr = (getResponse as any).resultXdr
          ? (getResponse as any).resultXdr.toString()
          : 'Transaction execution failed on ledger';
        const parsed = parseContractError(errorStr, options.method);
        if (parsed) {
          throw parsed;
        }
        throw new TransactionSubmissionError(`Transaction failed: ${errorStr}`, sendResponse.hash);
      }

      return getResponse;
    } catch (error: any) {
      if (error instanceof ContractError || error instanceof TransactionTimeoutError) {
        throw error;
      }

      const errStr = String(error?.message || error || '');

      // Do not retry on contract execution error
      if (
        errStr.includes('txFAILED') ||
        errStr.includes('ContractError') ||
        errStr.includes('Error(Contract')
      ) {
        const parsed = parseContractError(errStr, options.method);
        if (parsed) throw parsed;
        throw error;
      }

      // Sequence error retry
      if (
        errStr.includes('txBAD_SEQ') ||
        errStr.includes('BAD_SEQ') ||
        errStr.includes('bad sequence')
      ) {
        if (
          attempt < maxAttempts &&
          options.sourceKeypair &&
          options.contractId &&
          options.method &&
          options.args
        ) {
          try {
            currentXdr = await buildInvokeTransaction(
              rpcUrl,
              networkPassphrase,
              options.contractId,
              options.method,
              options.args,
              options.sourceKeypair,
              { fee: currentFee },
            );
            continue;
          } catch (rebuildErr) {
            throw rebuildErr;
          }
        }
        throw error;
      }

      // Fee error retry
      if (
        errStr.includes('txINSUFFICIENT_FEE') ||
        errStr.includes('INSUFFICIENT_FEE') ||
        errStr.includes('insufficient_fee')
      ) {
        if (
          attempt < maxAttempts &&
          currentFee < maxFeeCap &&
          options.sourceKeypair &&
          options.contractId &&
          options.method &&
          options.args
        ) {
          const bumpedFee = currentFee * 2n < maxFeeCap ? currentFee * 2n : maxFeeCap;
          if (bumpedFee > currentFee) {
            currentFee = bumpedFee;
            try {
              currentXdr = await buildInvokeTransaction(
                rpcUrl,
                networkPassphrase,
                options.contractId,
                options.method,
                options.args,
                options.sourceKeypair,
                { fee: currentFee },
              );
              continue;
            } catch (rebuildErr) {
              throw rebuildErr;
            }
          }
        }
        throw error;
      }

      lastError = error;
    }
  }

  if (lastError instanceof ContractError) {
    throw lastError;
  }
  if (lastError) {
    throw lastError;
  }
  throw new TransactionSubmissionError(
    'Transaction submission failed after maximum retry attempts',
  );
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
export function scValToNative(scVal: xdr.ScVal): unknown {
  return sdkScValToNative(scVal);
}

/**
 * Formats a raw atomic token amount using the token's decimal precision.
 *
 * Returns a fixed-scale decimal string so callers can display balances without
 * accidentally dropping precision from the contract's smallest unit.
 */
export function formatAtomicAmount(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new Error('Decimals must be a non-negative integer');
  }

  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const raw = absolute.toString();

  if (decimals === 0) {
    return negative ? `-${raw}` : raw;
  }

  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals);
  const sign = negative ? '-' : '';

  return `${sign}${whole}.${fraction}`;
}

/**
 * Builds an unsigned transaction XDR for offline signing.
 *
 * @param rpcUrl           - The Soroban RPC endpoint URL.
 * @param networkPassphrase - The Stellar network passphrase.
 * @param contractId       - The deployed contract ID (C... address).
 * @param method           - The contract function name to invoke.
 * @param args             - Array of xdr.ScVal arguments.
 * @param sourcePublicKey  - The public key of the transaction source account.
 * @returns The unsigned transaction XDR string (requires signing before submission).
 */
export async function buildUnsignedTransaction(
  rpcUrl: string,
  networkPassphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourcePublicKey: string,
): Promise<string> {
  const server = new SorobanRpc.Server(rpcUrl);
  const sourceAccount = await server.getAccount(sourcePublicKey);

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

  // Return unsigned transaction
  return assembled.toXDR();
}

/**
 * Signs a transaction XDR with the provided keypair.
 *
 * @param txXdr      - The unsigned transaction in XDR format.
 * @param networkPassphrase - The Stellar network passphrase.
 * @param keypair    - The keypair to sign the transaction with.
 * @returns The signed transaction XDR string.
 */
export function signTransaction(
  txXdr: string,
  networkPassphrase: string,
  keypair: Keypair,
): string {
  const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
  tx.sign(keypair);
  return tx.toXDR();
}

/**
 * Simulates a contract invocation without building or submitting a transaction.
 *
 * @param rpcUrl           - The Soroban RPC endpoint URL.
 * @param networkPassphrase - The Stellar network passphrase.
 * @param contractId       - The deployed contract ID (C... address).
 * @param method           - The contract function name to invoke.
 * @param args             - Array of xdr.ScVal arguments.
 * @param sourcePublicKey  - The public key for simulation context.
 * @returns The simulation result including return value and cost.
 */
export async function simulateTransaction(
  rpcUrl: string,
  networkPassphrase: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourcePublicKey: string,
): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
  const server = new SorobanRpc.Server(rpcUrl);

  // Create a dummy account for simulation
  const account = new Account(sourcePublicKey, '0');

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simulated = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  return simulated;
}

/**
 * Converts a 32-byte hex string or Buffer to an ScVal.
 */
export function hashToScVal(hash: string | Buffer): xdr.ScVal {
  const buf = typeof hash === 'string' ? Buffer.from(hash, 'hex') : hash;
  if (buf.length !== 32) throw new Error('Hash must be exactly 32 bytes');
  return xdr.ScVal.scvBytes(buf);
}
