// SPDX-License-Identifier: MIT
/**
 * @bc-forge/sdk — Tests for RBAC initialization methods
 *
 * Covers the `init_rbac` deployment step (`initRbac`), the initial SuperAdmin
 * assignment (`grantSuperAdmin` / `revokeSuperAdmin`), and the `hasRole` view.
 */

import { jest } from '@jest/globals';
import { Keypair, Networks, xdr } from '@stellar/stellar-sdk';
import { bcForgeClient, Role } from './client';
import type { TransactionResult } from './client';
import { addressToScVal } from './utils';

const MOCK_RPC_URL = 'https://soroban-testnet.stellar.org';
const MOCK_NETWORK = Networks.TESTNET;
const MOCK_CONTRACT_ID = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

type InvokeContractMock = jest.Mock<
  (method: string, args: unknown[], source: Keypair) => Promise<TransactionResult>
>;

function makeClient() {
  return new bcForgeClient({
    rpcUrl: MOCK_RPC_URL,
    networkPassphrase: MOCK_NETWORK,
    contractId: MOCK_CONTRACT_ID,
  });
}

describe('bcForgeClient RBAC init', () => {
  let client: bcForgeClient;
  let adminKeypair: Keypair;

  beforeEach(() => {
    client = makeClient();
    adminKeypair = Keypair.random();
  });

  describe('grantSuperAdmin', () => {
    it('invokes grant_role with the SuperAdmin role and target address', async () => {
      const target = Keypair.random().publicKey();
      const invokeContract = jest.fn(async () => ({
        success: true,
        hash: 'mock-hash',
        returnValue: null,
      }));
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.grantSuperAdmin(target, adminKeypair);

      expect(result).toEqual({ success: true, hash: 'mock-hash', returnValue: null });
      expect(invokeContract).toHaveBeenCalledTimes(1);
      const [method, args, source] = invokeContract.mock.calls[0] as unknown as [
        string,
        xdr.ScVal[],
        Keypair,
      ];
      expect(method).toBe('grant_role');
      expect(args).toHaveLength(3);
      expect(args[0].toXDR('base64')).toBe(
        addressToScVal(adminKeypair.publicKey()).toXDR('base64'),
      );
      expect(args[1].sym().toString()).toBe(Role.SuperAdmin);
      expect(args[2].toXDR('base64')).toBe(addressToScVal(target).toXDR('base64'));
      expect(source).toBe(adminKeypair);
    });

    it('propagates a failed grant_role transaction as an unsuccessful result', async () => {
      const invokeContract = jest.fn(async () => ({ success: false, hash: 'failed-hash' }));
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.grantSuperAdmin(Keypair.random().publicKey(), adminKeypair);

      expect(result.success).toBe(false);
      expect(result.hash).toBe('failed-hash');
    });
  });

  describe('revokeSuperAdmin', () => {
    it('invokes revoke_role with the SuperAdmin role and target address', async () => {
      const target = Keypair.random().publicKey();
      const invokeContract = jest.fn(async () => ({
        success: true,
        hash: 'mock-hash',
        returnValue: null,
      }));
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.revokeSuperAdmin(target, adminKeypair);

      expect(result.success).toBe(true);
      const [method, args, source] = invokeContract.mock.calls[0] as unknown as [
        string,
        xdr.ScVal[],
        Keypair,
      ];
      expect(method).toBe('revoke_role');
      expect(args[1].sym().toString()).toBe(Role.SuperAdmin);
      expect(args[2].toXDR('base64')).toBe(addressToScVal(target).toXDR('base64'));
      expect(source).toBe(adminKeypair);
    });

    it('returns the unsuccessful result when the contract rejects the revoke', async () => {
      const invokeContract = jest.fn(async () => ({ success: false, hash: 'revoke-failed' }));
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.revokeSuperAdmin(Keypair.random().publicKey(), adminKeypair);

      expect(result.success).toBe(false);
      expect(result.hash).toBe('revoke-failed');
    });
  });

  describe('hasRole', () => {
    it('returns true when the contract reports the role is held', async () => {
      const target = Keypair.random().publicKey();
      const queryContract = jest.fn(async () => xdr.ScVal.scvBool(true));
      (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

      await expect(client.hasRole(Role.SuperAdmin, target)).resolves.toBe(true);
      const [method, args] = queryContract.mock.calls[0] as unknown as [string, xdr.ScVal[]];
      expect(method).toBe('has_role');
      expect(args[0].sym().toString()).toBe(Role.SuperAdmin);
      expect(args[1].toXDR('base64')).toBe(addressToScVal(target).toXDR('base64'));
    });

    it('returns false when the contract reports the role is not held', async () => {
      const queryContract = jest.fn(async () => xdr.ScVal.scvBool(false));
      (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

      await expect(client.hasRole(Role.Minter, Keypair.random().publicKey())).resolves.toBe(false);
    });
  });

  describe('renounceRole', () => {
    it('invokes renounce_role with the caller address and role', async () => {
      const invokeContract = jest.fn(async () => ({
        success: true,
        hash: 'mock-hash',
        returnValue: null,
      }));
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.renounceRole(Role.Minter, adminKeypair);

      expect(result.success).toBe(true);
      const [method, args, source] = invokeContract.mock.calls[0] as unknown as [
        string,
        xdr.ScVal[],
        Keypair,
      ];
      expect(method).toBe('renounce_role');
      expect(args).toHaveLength(2);
      expect(args[0].toXDR('base64')).toBe(
        addressToScVal(adminKeypair.publicKey()).toXDR('base64'),
      );
      expect(args[1].sym().toString()).toBe(Role.Minter);
      expect(source).toBe(adminKeypair);
    });

    it('propagates a rejected renounce as an unsuccessful result', async () => {
      const invokeContract = jest.fn(async () => ({ success: false, hash: 'renounce-failed' }));
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.renounceRole(Role.SuperAdmin, adminKeypair);

      expect(result.success).toBe(false);
      expect(result.hash).toBe('renounce-failed');
    });
  });

  describe('getRoleHierarchy', () => {
    it('queries get_role_hierarchy and decodes the snake_case struct', async () => {
      const target = Keypair.random().publicKey();
      const queryContract = jest.fn(async () =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('address'),
            val: addressToScVal(target),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('is_admin'),
            val: xdr.ScVal.scvBool(false),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('is_super_admin'),
            val: xdr.ScVal.scvBool(true),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('is_minter'),
            val: xdr.ScVal.scvBool(true),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('is_pauser'),
            val: xdr.ScVal.scvBool(false),
          }),
        ]),
      );
      (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

      const hierarchy = await client.getRoleHierarchy(target);

      expect(hierarchy).toEqual({
        address: target,
        isAdmin: false,
        isSuperAdmin: true,
        isMinter: true,
        isPauser: false,
      });
      const [method, args] = queryContract.mock.calls[0] as unknown as [string, xdr.ScVal[]];
      expect(method).toBe('get_role_hierarchy');
      expect(args[0].toXDR('base64')).toBe(addressToScVal(target).toXDR('base64'));
    });
  });

  describe('proposal listings (#917)', () => {
    function listingMap() {
      return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('pending_ids'),
          val: xdr.ScVal.scvVec([xdr.ScVal.scvU64(new xdr.Uint64(1)), xdr.ScVal.scvU64(new xdr.Uint64(3))]),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('approved_ids'),
          val: xdr.ScVal.scvVec([xdr.ScVal.scvU64(new xdr.Uint64(2))]),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol('next_cursor'),
          val: xdr.ScVal.scvU64(new xdr.Uint64(50)),
        }),
      ]);
    }

    it('listLegacyProposals queries with a u64 cursor and decodes ID lists', async () => {
      const queryContract = jest.fn(async () => listingMap());
      (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

      const lists = await client.listLegacyProposals(0);

      expect(lists.pendingIds).toEqual([1n, 3n]);
      expect(lists.approvedIds).toEqual([2n]);
      expect(lists.nextCursor).toBe(50n);
      const [method, args] = queryContract.mock.calls[0] as unknown as [string, xdr.ScVal[]];
      expect(method).toBe('list_legacy_proposals');
      expect(args[0].u64().toString()).toBe('0');
    });

    it('listUpgradeProposals passes the resume cursor through', async () => {
      const queryContract = jest.fn(async () => listingMap());
      (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

      await client.listUpgradeProposals(50);

      const [method, args] = queryContract.mock.calls[0] as unknown as [string, xdr.ScVal[]];
      expect(method).toBe('list_upgrade_proposals');
      expect(args[0].u64().toString()).toBe('50');
    });

    it('decodes a null cursor as null', async () => {
      const queryContract = jest.fn(async () =>
        xdr.ScVal.scvMap([
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('pending_ids'),
            val: xdr.ScVal.scvVec([]),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('approved_ids'),
            val: xdr.ScVal.scvVec([]),
          }),
          new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('next_cursor'),
            val: xdr.ScVal.scvVoid(),
          }),
        ]),
      );
      (client as unknown as { queryContract: typeof queryContract }).queryContract = queryContract;

      const lists = await client.listLegacyProposals(0);

      expect(lists.pendingIds).toEqual([]);
      expect(lists.approvedIds).toEqual([]);
      expect(lists.nextCursor).toBeNull();
    });
  });

  describe('initRbac', () => {
    it('runs migrate_admin then grant_role(SuperAdmin) as the init_rbac step', async () => {
      const superAdmin = Keypair.random().publicKey();
      const calls: Array<[string, xdr.ScVal[]]> = [];
      const invokeContract = jest.fn(async (method: string, args: unknown[]) => {
        calls.push([method, args as xdr.ScVal[]]);
        return { success: true, hash: `hash-${method}`, returnValue: null };
      });
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.initRbac(superAdmin, adminKeypair);

      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe('migrate_admin');
      expect(calls[0][1]).toHaveLength(0);

      expect(calls[1][0]).toBe('grant_role');
      const grantArgs = calls[1][1];
      expect(grantArgs).toHaveLength(3);
      expect(grantArgs[0].toXDR('base64')).toBe(
        addressToScVal(adminKeypair.publicKey()).toXDR('base64'),
      );
      expect(grantArgs[1].sym().toString()).toBe(Role.SuperAdmin);
      expect(grantArgs[2].toXDR('base64')).toBe(addressToScVal(superAdmin).toXDR('base64'));

      expect(result.migrate.success).toBe(true);
      expect(result.grant.success).toBe(true);
    });

    it('reports the grant failure when the SuperAdmin assignment is rejected', async () => {
      const invokeContract = jest.fn(async (method: string) =>
        method === 'grant_role'
          ? { success: false, hash: 'grant-failed' }
          : { success: true, hash: 'migrate-ok', returnValue: null },
      );
      (client as unknown as { invokeContract: InvokeContractMock }).invokeContract =
        invokeContract as unknown as InvokeContractMock;

      const result = await client.initRbac(Keypair.random().publicKey(), adminKeypair);

      expect(result.migrate.success).toBe(true);
      expect(result.grant.success).toBe(false);
      expect(result.grant.hash).toBe('grant-failed');
    });
  });
});
