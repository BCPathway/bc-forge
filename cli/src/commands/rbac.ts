// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { bcForgeClient, Role } from '@bc-forge/sdk';
import { addNetworkOptions } from '../network.js';
import { getSecretKey } from '../utils/config.js';

export function parseRole(value: string): Role {
    const role = Object.values(Role).find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    if (!role) throw new Error(`Invalid role "${value}". Expected SuperAdmin, Admin, Minter, or Pauser.`);
    return role;
}

export function validateAddress(value: string): string {
    if (!StrKey.isValidEd25519PublicKey(value)) throw new Error(`Invalid Stellar address: ${value}`);
    return value;
}

export function createRbacCommand(): Command {
    const root = new Command('rbac').description('Manage role-based access control');
    const roleNames = 'SuperAdmin, Admin, Minter, or Pauser';

    for (const action of ['grant', 'revoke'] as const) {
        const command = new Command(action)
            .description(`${action === 'grant' ? 'Grant' : 'Revoke'} a role for an address`)
            .argument('<role>', roleNames)
            .argument('<address>', 'Stellar G... address')
            .option('--secret-key <key>', 'Admin source secret key')
            .option('--contract-id <id>', 'Admin contract ID');
        addNetworkOptions(command);
        command.action(async (roleValue: string, address: string, opts) => {
            const role = parseRole(roleValue);
            const target = validateAddress(address);
            const secret = opts.secretKey ?? getSecretKey();
            if (!secret) throw new Error('A source secret key is required');
            if (!opts.contractId) throw new Error('A contract ID is required via --contract-id');
            const source = Keypair.fromSecret(secret);
            const client = new bcForgeClient({ rpcUrl: opts.rpcUrl, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId });
            const result = action === 'grant'
                ? await client.grantRole(role, target, source)
                : await client.revokeRole(role, target, source);
            process.stdout.write(`${action === 'grant' ? 'Granted' : 'Revoked'} ${role} for ${target} (tx ${result.hash})\n`);
        });
        root.addCommand(command);
    }

    const hasRole = new Command('has-role')
        .argument('<role>', roleNames)
        .argument('<address>', 'Stellar G... address')
        .option('--contract-id <id>', 'Admin contract ID');
    addNetworkOptions(hasRole);
    hasRole.action(async (roleValue: string, address: string, opts) => {
        const role = parseRole(roleValue);
        const target = validateAddress(address);
        if (!opts.contractId) throw new Error('A contract ID is required via --contract-id');
        const client = new bcForgeClient({ rpcUrl: opts.rpcUrl, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId });
        process.stdout.write(`${await client.hasRole(role, target)}\n`);
    });
    root.addCommand(hasRole);

    const list = new Command('list')
        .argument('<address>', 'Stellar G... address')
        .option('--contract-id <id>', 'Admin contract ID');
    addNetworkOptions(list);
    list.action(async (address: string, opts) => {
        const target = validateAddress(address);
        if (!opts.contractId) throw new Error('A contract ID is required via --contract-id');
        const client = new bcForgeClient({ rpcUrl: opts.rpcUrl, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId });
        process.stdout.write(`${JSON.stringify(await client.getRoleHierarchy(target), null, 2)}\n`);
    });
    root.addCommand(list);

    return root;
}
