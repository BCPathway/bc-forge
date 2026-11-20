// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import { Command } from 'commander';
import { StrKey } from '@stellar/stellar-sdk';
import { bcForgeClient } from '@bc-forge/sdk';
import { addNetworkOptions } from '../network.js';

export interface SplitRecipientFileEntry { to: string; amount: string }

export function loadSplitRecipients(filePath: string): SplitRecipientFileEntry[] {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
    const entries = Array.isArray(parsed) ? parsed : (parsed as { recipients?: unknown })?.recipients;
    if (!Array.isArray(entries) || entries.length === 0) throw new Error('Recipients file must contain a non-empty array');
    return entries.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object') throw new Error('Invalid recipient entry');
        const value = entry as { to?: unknown; address?: unknown; amount?: unknown };
        const to = typeof value.to === 'string' ? value.to : value.address;
        const amount = typeof value.amount === 'string' ? value.amount : typeof value.amount === 'number' ? String(value.amount) : undefined;
        if (typeof to !== 'string' || !StrKey.isValidEd25519PublicKey(to)) throw new Error(`Invalid recipient address: ${String(to)}`);
        if (!amount || !/^\d+$/.test(amount) || BigInt(amount) <= 0n) throw new Error(`Invalid recipient amount: ${String(amount)}`);
        return { to, amount };
    });
}

export function createSplitCommand(): Command {
    const root = new Command('split').description('Manage split contract invoices');

    const create = new Command('create')
        .requiredOption('--recipients-file <path.json>', 'JSON recipients file')
        .option('--token <id>', 'SEP-41 token contract ID')
        .requiredOption('--contract-id <id>', 'Split contract ID')
        .requiredOption('--source <secret>', 'Admin source secret key');
    addNetworkOptions(create);
    create.action((opts) => {
        const recipients = loadSplitRecipients(opts.recipientsFile);
        process.stdout.write(JSON.stringify({ recipients, token: opts.token }) + '\n');
    });
    root.addCommand(create);

    const release = new Command('release')
        .requiredOption('--invoice-id <id>', 'Invoice ID')
        .requiredOption('--contract-id <id>', 'Split contract ID')
        .requiredOption('--source <secret>', 'Admin source secret key');
    addNetworkOptions(release);
    release.action((opts) => {
        if (!/^\d+$/.test(opts.invoiceId)) throw new Error('Invoice ID must be a non-negative integer');
        process.stdout.write(`release invoice ${opts.invoiceId}\n`);
    });
    root.addCommand(release);

    const retry = new Command('retry-failed')
        .requiredOption('--invoice-id <id>', 'Invoice ID')
        .requiredOption('--recipient <addr>', 'Recipient G... address')
        .requiredOption('--contract-id <id>', 'Split contract ID')
        .requiredOption('--source <secret>', 'Admin source secret key');
    addNetworkOptions(retry);
    retry.action((opts) => {
        if (!/^\d+$/.test(opts.invoiceId)) throw new Error('Invoice ID must be a non-negative integer');
        if (!StrKey.isValidEd25519PublicKey(opts.recipient)) throw new Error(`Invalid recipient address: ${opts.recipient}`);
        process.stdout.write(`retry invoice ${opts.invoiceId} for ${opts.recipient}\n`);
    });
    root.addCommand(retry);

    const info = new Command('info')
        .requiredOption('--invoice-id <id>', 'Invoice ID')
        .requiredOption('--contract-id <id>', 'Split contract ID');
    addNetworkOptions(info);
    info.action(async (opts) => {
        if (!/^\d+$/.test(opts.invoiceId)) throw new Error('Invoice ID must be a non-negative integer');
        const client = new bcForgeClient({ rpcUrl: opts.rpcUrl, networkPassphrase: opts.networkPassphrase, contractId: opts.contractId });
        const invoice = await client.getSplitInvoice(BigInt(opts.invoiceId), opts.contractId);
        process.stdout.write(`${JSON.stringify(invoice, null, 2)}\n`);
    });
    root.addCommand(info);

    return root;
}
