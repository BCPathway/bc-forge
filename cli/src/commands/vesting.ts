// SPDX-License-Identifier: MIT
import { Command } from 'commander';
import { StrKey } from '@stellar/stellar-sdk';
import { bcForgeClient } from '@bc-forge/sdk';
import { addNetworkOptions } from '../network.js';

function address(value: string): string {
    if (!StrKey.isValidEd25519PublicKey(value)) throw new Error(`Invalid Stellar address: ${value}`);
    return value;
}

function positiveInt(value: string, name: string): bigint {
    if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new Error(`${name} must be a positive integer`);
    return BigInt(value);
}

function ledgerCount(value: string, name: string): number {
    if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
    return parsed;
}

export function createVestingCommand(): Command {
    const root = new Command('vesting').description('Manage vesting schedules');

    const create = new Command('create')
        .requiredOption('--beneficiary <addr>', 'Beneficiary G... address')
        .requiredOption('--amount <amount>', 'Positive token amount')
        .requiredOption('--cliff <ledgers>', 'Cliff ledger count')
        .requiredOption('--duration <ledgers>', 'Duration ledger count')
        .option('--revocable', 'Allow the schedule to be revoked', false)
        .requiredOption('--contract-id <id>', 'Vesting contract ID')
        .requiredOption('--source <secret>', 'Admin source secret key');
    addNetworkOptions(create);
    create.action(async (opts) => {
        address(opts.beneficiary);
        positiveInt(opts.amount, 'Amount');
        const cliff = ledgerCount(opts.cliff, 'Cliff');
        const duration = ledgerCount(opts.duration, 'Duration');
        if (duration === 0 || cliff > duration) throw new Error('Duration must be positive and cliff must not exceed duration');
        process.stdout.write(JSON.stringify({ beneficiary: opts.beneficiary, amount: opts.amount, cliff, duration, revocable: opts.revocable }) + '\n');
    });
    root.addCommand(create);

    const info = new Command('info')
        .requiredOption('--beneficiary <addr>', 'Beneficiary G... address')
        .requiredOption('--contract-id <id>', 'Vesting contract ID');
    addNetworkOptions(info);
    info.action(async (opts) => {
        address(opts.beneficiary);
        const client = new bcForgeClient({ rpcUrl: opts.rpcUrl, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId });
        process.stdout.write(`${JSON.stringify(await client.getVestingInfo(opts.beneficiary, opts.contractId), null, 2)}\n`);
    });
    root.addCommand(info);

    for (const subcommand of ['claim', 'revoke'] as const) {
        const command = new Command(subcommand)
            .option('--beneficiary <addr>', 'Beneficiary G... address')
            .option('--schedule-id <id>', 'Vesting schedule ID')
            .requiredOption('--contract-id <id>', 'Vesting contract ID')
            .requiredOption('--source <secret>', 'Caller source secret key');
        addNetworkOptions(command);
        command.action((opts) => {
            if (subcommand === 'claim' && opts.beneficiary) address(opts.beneficiary);
            if (subcommand === 'revoke' && opts.scheduleId !== undefined && !/^\d+$/.test(opts.scheduleId)) {
                throw new Error('Schedule ID must be a non-negative integer');
            }
            process.stdout.write(`${subcommand} command parsed\n`);
        });
        root.addCommand(command);
    }

    return root;
}
