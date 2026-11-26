// SPDX-License-Identifier: MIT
import { jest } from '@jest/globals';
import { Keypair, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { VestingClient, type VestingSchedule, type Milestone } from '../vestingClient';
import { addressToScVal, i128ToScVal, u32ToScVal } from '../utils';

const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_PASSPHRASE = 'Test SDF Network ; September 2015';

function baseSchedule(overrides: Partial<VestingSchedule> = {}): VestingSchedule {
  return {
    scheduleId: 1n,
    beneficiary: Keypair.random().publicKey(),
    totalAmount: 1000n,
    cliffLedger: 100,
    endLedger: 200,
    releasedAmount: 0n,
    revocable: true,
    ...overrides,
  };
}

function structScVal(fields: Record<string, xdr.ScVal>): xdr.ScVal {
  return xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );
}

function vestingInfoScVal(info: {
  scheduleId: bigint;
  beneficiary: string;
  totalAmount: bigint;
  cliffLedger: number;
  endLedger: number;
  releasedAmount: bigint;
  revocable: boolean;
  startLedger: number;
  claimableAmount: bigint;
  revoked: boolean;
}): xdr.ScVal {
  return structScVal({
    schedule_id: nativeToScVal(info.scheduleId, { type: 'u64' }),
    schedule: structScVal({
      beneficiary: addressToScVal(info.beneficiary),
      total_amount: i128ToScVal(info.totalAmount),
      cliff_ledger: u32ToScVal(info.cliffLedger),
      end_ledger: u32ToScVal(info.endLedger),
      released_amount: i128ToScVal(info.releasedAmount),
      revocable: xdr.ScVal.scvBool(info.revocable),
    }),
    start_ledger: u32ToScVal(info.startLedger),
    claimable_amount: i128ToScVal(info.claimableAmount),
    revoked: xdr.ScVal.scvBool(info.revoked),
  });
}

describe('VestingClient surface', () => {
  let client: VestingClient;

  beforeEach(() => {
    client = new VestingClient({
      rpcUrl: MOCK_RPC_URL,
      networkPassphrase: MOCK_PASSPHRASE,
      contractId: MOCK_CONTRACT_ID,
    });
  });

  it('exposes all required methods', () => {
    expect(typeof client.createVesting).toBe('function');
    expect(typeof client.release).toBe('function');
    expect(typeof client.revoke).toBe('function');
    expect(typeof client.authorizeClaimer).toBe('function');
    expect(typeof client.claimOnBehalfOf).toBe('function');
    expect(typeof client.setMilestones).toBe('function');
    expect(typeof client.getVestingInfo).toBe('function');
    expect(typeof client.calculateClaimable).toBe('function');
  });

  it('invokes create_vesting with the expected arguments', async () => {
    const invokeContract = jest.fn(async () => ({ success: true, hash: 'mock-hash' }));
    (client as unknown as { invokeContract: typeof invokeContract }).invokeContract =
      invokeContract;

    const source = Keypair.random();
    const beneficiary = Keypair.random().publicKey();

    await client.createVesting(
      {
        beneficiary,
        totalAmount: 5000n,
        cliffLedgers: 10,
        durationLedgers: 100,
        revocable: true,
      },
      source,
    );

    expect(invokeContract).toHaveBeenCalledWith('create_vesting', expect.any(Array), source);
  });

  it('decodes get_vesting_info into typed VestingSchedule records', async () => {
    const beneficiary = Keypair.random().publicKey();
    const queryContract = jest.fn(async () =>
      xdr.ScVal.scvVec([
        vestingInfoScVal({
          scheduleId: 7n,
          beneficiary,
          totalAmount: 1000n,
          cliffLedger: 100,
          endLedger: 200,
          releasedAmount: 250n,
          revocable: true,
          startLedger: 50,
          claimableAmount: 100n,
          revoked: false,
        }),
      ]),
    );
    (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

    const result = await client.getVestingInfo(beneficiary);

    expect(queryContract).toHaveBeenCalledWith('get_vesting_info', expect.any(Array));
    expect(result).toEqual([
      {
        scheduleId: 7n,
        beneficiary,
        totalAmount: 1000n,
        cliffLedger: 100,
        endLedger: 200,
        releasedAmount: 250n,
        revocable: true,
      },
    ]);
  });
});

describe('VestingClient.calculateClaimable', () => {
  let client: VestingClient;

  beforeEach(() => {
    client = new VestingClient({
      rpcUrl: MOCK_RPC_URL,
      networkPassphrase: MOCK_PASSPHRASE,
      contractId: MOCK_CONTRACT_ID,
    });
  });

  it('returns 0 before the cliff', () => {
    const schedule = baseSchedule({ cliffLedger: 100, endLedger: 200, totalAmount: 1000n });
    expect(client.calculateClaimable(schedule, 50)).toBe(0n);
    expect(client.calculateClaimable(schedule, 99)).toBe(0n);
  });

  it('returns 50% of the amount at 50% of the cliff-to-end duration', () => {
    const schedule = baseSchedule({ cliffLedger: 100, endLedger: 200, totalAmount: 1000n });
    expect(client.calculateClaimable(schedule, 150)).toBe(500n);
  });

  it('returns the full amount once past the end ledger', () => {
    const schedule = baseSchedule({ cliffLedger: 100, endLedger: 200, totalAmount: 1000n });
    expect(client.calculateClaimable(schedule, 250)).toBe(1000n);
  });

  it('subtracts the already-released amount', () => {
    const schedule = baseSchedule({
      cliffLedger: 100,
      endLedger: 200,
      totalAmount: 1000n,
      releasedAmount: 300n,
    });
    expect(client.calculateClaimable(schedule, 150)).toBe(200n);
  });

  it('accelerates the claimable amount when a milestone has unlocked', () => {
    const schedule = baseSchedule({ cliffLedger: 100, endLedger: 200, totalAmount: 1000n });
    const milestones: Milestone[] = [{ unlockLedger: 120, amount: 800n }];
    // Linear portion at ledger 120 would be (1000 * 20) / 100 = 200, but the
    // milestone has unlocked 800, which must win since it is larger.
    expect(client.calculateClaimable(schedule, 120, milestones)).toBe(800n);
  });

  it('ignores milestones that have not unlocked yet', () => {
    const schedule = baseSchedule({ cliffLedger: 100, endLedger: 200, totalAmount: 1000n });
    const milestones: Milestone[] = [{ unlockLedger: 180, amount: 900n }];
    expect(client.calculateClaimable(schedule, 150, milestones)).toBe(500n);
  });

  it('never returns more than the schedule total', () => {
    const schedule = baseSchedule({ cliffLedger: 100, endLedger: 200, totalAmount: 1000n });
    const milestones: Milestone[] = [{ unlockLedger: 100, amount: 5000n }];
    expect(client.calculateClaimable(schedule, 150, milestones)).toBe(1000n);
  });
});
