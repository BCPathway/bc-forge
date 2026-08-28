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
