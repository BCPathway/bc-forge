// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — VestingClient
 *
 * Dedicated, strongly-typed TypeScript client for the `bc-forge-vesting`
 * Soroban contract. Supersedes the untyped `bcForgeClient.getVestingInfo`
 * helper with a full set of read and write methods plus a pure
 * claimable-amount calculator for client-side display and estimation.
 */

import {
  rpc as SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  xdr,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import type { WalletAdapter } from './walletAdapter';

import {
  buildInvokeTransaction,
  submitTransaction,
  addressToScVal,
  i128ToScVal,
  u32ToScVal,
  scValToNative,
  buildUnsignedTransaction,
  signTransaction,
  simulateTransaction,
} from './utils';

import { SimulationError, RPCError, SignerRequiredError } from './errors';
import type { TransactionResult } from './client';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Either a raw Keypair or a connected WalletAdapter can sign a transaction. */
export type Signer = Keypair | WalletAdapter;

/** A single vesting grant, as returned by `get_vesting_info`. */
export interface VestingSchedule {
  scheduleId: bigint;
  beneficiary: string;
  totalAmount: bigint;
  cliffLedger: number;
  endLedger: number;
  releasedAmount: bigint;
  revocable: boolean;
}

/** A milestone tranche: `amount` unlocks at `unlockLedger`, in addition to the linear curve. */
export interface Milestone {
  unlockLedger: number;
  amount: bigint;
}

/** Parameters for creating a new vesting schedule. */
export interface CreateVestingParams {
  beneficiary: string;
  totalAmount: bigint;
  cliffLedgers: number;
  durationLedgers: number;
  revocable: boolean;
}

export interface VestingClientConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Deployed bc-forge-vesting contract ID */
  contractId: string;
  /** Optional wallet adapter for browser-based signing flows */
  walletAdapter?: WalletAdapter;
}

interface RawVestingSchedule {
  beneficiary: string;
  total_amount: bigint;
  cliff_ledger: number;
  end_ledger: number;
  released_amount: bigint;
  revocable: boolean;
}

interface RawVestingInfo {
  schedule_id: bigint;
  schedule: RawVestingSchedule;
  start_ledger: number;
  claimable_amount: bigint;
  revoked: boolean;
}

function toVestingSchedule(raw: RawVestingInfo): VestingSchedule {
  return {
    scheduleId: BigInt(raw.schedule_id),
    beneficiary: raw.schedule.beneficiary,
    totalAmount: BigInt(raw.schedule.total_amount),
    cliffLedger: Number(raw.schedule.cliff_ledger),
    endLedger: Number(raw.schedule.end_ledger),
    releasedAmount: BigInt(raw.schedule.released_amount),
    revocable: raw.schedule.revocable,
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class VestingClient {
  private rpcUrl: string;
  private networkPassphrase: string;
  private contractId: string;
  private server: SorobanRpc.Server;
  private contract: Contract;
  private walletAdapter?: WalletAdapter;

  constructor(config: VestingClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.networkPassphrase = config.networkPassphrase;
    this.contractId = config.contractId;
    this.server = new SorobanRpc.Server(this.rpcUrl);
    this.contract = new Contract(this.contractId);
    this.walletAdapter = config.walletAdapter;
  }

  /** Replace or set the wallet adapter at runtime. */
  setWalletAdapter(adapter?: WalletAdapter): void {
    this.walletAdapter = adapter;
  }

  /** The wallet adapter configured on this client, if any. */
  getWalletAdapter(): WalletAdapter | undefined {
    return this.walletAdapter;
  }

  // ─── Write Transactions ──────────────────────────────────────────────────

  /**
   * Create a new vesting schedule for a beneficiary. Admin-only on-chain.
   */
  async createVesting(params: CreateVestingParams, signer?: Signer): Promise<TransactionResult> {
    return this.invokeContract(
      'create_vesting',
      [
        addressToScVal(params.beneficiary),
        i128ToScVal(params.totalAmount),
        u32ToScVal(params.cliffLedgers),
        u32ToScVal(params.durationLedgers),
        nativeToScVal(params.revocable),
      ],
      signer,
    );
  }

  /**
   * Release currently-claimable tokens to the beneficiary across all of
   * their schedules. Must be signed by the beneficiary.
   */
  async release(beneficiary: string, signer?: Signer): Promise<TransactionResult> {
    return this.invokeContract('release', [addressToScVal(beneficiary)], signer);
  }

  /**
   * Revoke a revocable schedule, returning the unvested balance to the
   * admin. Admin-only on-chain.
   */
  async revoke(scheduleId: bigint, signer?: Signer): Promise<TransactionResult> {
    return this.invokeContract('revoke', [nativeToScVal(scheduleId, { type: 'u64' })], signer);
  }

  /**
   * Authorize (or revoke authorization for) `claimer` to claim on the
   * signer's behalf. Must be signed by the beneficiary.
   *
   * @param claimer   - Delegate address to authorize
   * @param signer    - Beneficiary's signer
   * @param authorize - `true` to grant claim authority, `false` to revoke it (default `true`)
   */
  async authorizeClaimer(
    claimer: string,
    signer?: Signer,
    authorize = true,
  ): Promise<TransactionResult> {
    const beneficiary = await this.resolvePublicKey(signer);
    return this.invokeContract(
      'authorize_claimer',
      [addressToScVal(beneficiary), addressToScVal(claimer), nativeToScVal(authorize)],
      signer,
    );
  }

  /**
   * Claim vested tokens on behalf of `beneficiary`. The caller must be the
   * beneficiary themself or a delegate previously authorized via
   * {@link authorizeClaimer}. Funds always move to `beneficiary`.
   */
  async claimOnBehalfOf(beneficiary: string, signer?: Signer): Promise<TransactionResult> {
    const caller = await this.resolvePublicKey(signer);
    return this.invokeContract(
      'claim_on_behalf_of',
      [addressToScVal(caller), addressToScVal(beneficiary)],
      signer,
    );
  }

  /**
   * Attach milestone tranches to an existing schedule. Admin-only on-chain.
   */
  async setMilestones(
    scheduleId: bigint,
    milestones: Milestone[],
    signer?: Signer,
  ): Promise<TransactionResult> {
    const milestonesScVal = xdr.ScVal.scvVec(
      milestones.map((m) =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('amount'),
            val: i128ToScVal(m.amount),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('unlock_ledger'),
            val: u32ToScVal(m.unlockLedger),
          }),
        ]),
      ),
    );
    return this.invokeContract(
      'set_milestones',
      [nativeToScVal(scheduleId, { type: 'u64' }), milestonesScVal],
      signer,
    );
  }

  // ─── Read-Only Queries ───────────────────────────────────────────────────

  /**
   * Fetch all vesting schedules for a beneficiary.
   */
  async getVestingInfo(beneficiary: string): Promise<VestingSchedule[]> {
    const result = await this.queryContract('get_vesting_info', [addressToScVal(beneficiary)]);
    const raw = scValToNative(result) as RawVestingInfo[];
    return raw.map(toVestingSchedule);
  }

  /**
   * Pure helper: compute the amount currently claimable for a schedule,
   * given the cliff, linear slope between the cliff and end ledger, and any
   * milestone tranches that have unlocked by `currentLedger`. Milestones
   * only ever raise the floor set by the linear curve. Performs no network
   * calls.
   */
  calculateClaimable(
    schedule: VestingSchedule,
    currentLedger: number,
    milestones: Milestone[] = [],
  ): bigint {
    if (currentLedger < schedule.cliffLedger) {
      return 0n;
    }

    let linear: bigint;
    if (currentLedger >= schedule.endLedger) {
      linear = schedule.totalAmount;
    } else {
      const elapsed = BigInt(currentLedger - schedule.cliffLedger);
      const totalDuration = BigInt(schedule.endLedger - schedule.cliffLedger);
      linear = totalDuration > 0n ? (schedule.totalAmount * elapsed) / totalDuration : 0n;
    }

    let milestoneTotal = 0n;
    for (const milestone of milestones) {
      if (milestone.unlockLedger <= currentLedger) {
        milestoneTotal += milestone.amount;
      }
    }

    let vested = linear > milestoneTotal ? linear : milestoneTotal;
    if (vested > schedule.totalAmount) {
      vested = schedule.totalAmount;
    }

    const claimable = vested - schedule.releasedAmount;
    return claimable > 0n ? claimable : 0n;
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  private async resolvePublicKey(signer?: Signer): Promise<string> {
    if (!signer) {
      if (!this.walletAdapter?.publicKey) throw new SignerRequiredError();
      return this.walletAdapter.publicKey;
    }
    if (signer instanceof Keypair) return signer.publicKey();
    const adapter = signer as WalletAdapter;
    if (!adapter.publicKey) throw new SignerRequiredError('Wallet adapter is not connected');
    return adapter.publicKey;
  }

  private async withRetry<T>(fn: () => Promise<T>, retries: number = 3): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
        }
      }
    }
    throw lastError;
  }

  private async queryContract(method: string, args: xdr.ScVal[]): Promise<xdr.ScVal> {
    return this.withRetry(async () => {
      try {
        const account = new (await import('@stellar/stellar-sdk')).Account(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          '0',
        );

        const tx = new TransactionBuilder(account, {
          fee: '100',
          networkPassphrase: this.networkPassphrase,
        })
          .addOperation(this.contract.call(method, ...args))
          .setTimeout(30)
          .build();

        const simulated = await this.server.simulateTransaction(tx);

        if (SorobanRpc.Api.isSimulationError(simulated)) {
          throw new SimulationError(`Query failed: ${simulated.error}`, simulated.error);
        }

        if (!SorobanRpc.Api.isSimulationSuccess(simulated) || !simulated.result) {
          throw new SimulationError('Query returned no result');
        }

        return simulated.result.retval;
      } catch (error: unknown) {
        if (error instanceof SimulationError) throw error;
        throw new RPCError('RPC call failed', error);
      }
    });
  }

  private async invokeContract(
    method: string,
    args: xdr.ScVal[],
    source?: Signer,
  ): Promise<TransactionResult> {
    const isAdapter = Boolean(source) && !(source instanceof Keypair);
    const adapter = isAdapter ? (source as WalletAdapter) : this.walletAdapter;
    const actualSource = isAdapter ? undefined : (source as Keypair | undefined);

    if (!actualSource && !adapter) throw new SignerRequiredError();
    if (!actualSource && (!adapter?.connected || !adapter.publicKey)) {
      throw new SignerRequiredError('Wallet adapter is not connected');
    }

    return this.withRetry(async () => {
      let txXdr: string;
      if (actualSource) {
        txXdr = await buildInvokeTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          actualSource,
        );
      } else {
        const unsignedXdr = await buildUnsignedTransaction(
          this.rpcUrl,
          this.networkPassphrase,
          this.contractId,
          method,
          args,
          adapter!.publicKey!,
        );
        txXdr = await adapter!.signTransaction(unsignedXdr);
      }

      const response = await submitTransaction(this.rpcUrl, txXdr);

      if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return {
          success: true,
          hash: (response as unknown as { hash?: string; txHash?: string }).hash ?? response.txHash,
          returnValue: response.returnValue ? scValToNative(response.returnValue) : undefined,
        };
      }

      return {
        success: false,
        hash: (response as unknown as { hash?: string; txHash?: string }).hash ?? response.txHash,
      };
    });
  }

  /**
   * Simulate a contract call without submitting a transaction.
   */
  async simulate(method: string, args: xdr.ScVal[], sourcePublicKey: string): Promise<unknown> {
    return simulateTransaction(
      this.rpcUrl,
      this.networkPassphrase,
      this.contractId,
      method,
      args,
      sourcePublicKey,
    );
  }

  /**
   * Sign an unsigned transaction XDR with a Keypair.
   */
  signTx(xdrString: string, signer: Keypair): string {
    return signTransaction(xdrString, this.networkPassphrase, signer);
  }
}
