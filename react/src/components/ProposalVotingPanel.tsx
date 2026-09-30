// SPDX-License-Identifier: MIT
import React, { useState } from 'react';
import type { Keypair } from '@stellar/stellar-sdk';
import type { TransactionResult } from '@bc-forge/sdk';

import { useProposalVoting, useWallet } from '../hooks';
import { parsePositiveInteger } from '../utils';
import { Alert } from './Alert';
import { Badge, type BadgeVariant } from './Badge';
import { TransactionToast, type TransactionToastStatus } from './TransactionToast';

/** On-chain identifier of a multi-sig proposal. */
export type ProposalId = bigint | number | string;

export interface ProposalSummary {
  /** On-chain proposal id, passed to the SDK's approve/execute calls. */
  id: ProposalId;
  /** Human-readable description of what the proposal would do. */
  description?: string;
  /** Action label, e.g. `'Mint'` or `'Pause'`. */
  action?: string;
  /** Approvals collected so far. */
  approvals?: number;
  /** Approvals required to execute. */
  quorum?: number;
  /** Whether the proposal has already been executed. */
  executed?: boolean;
}

export interface ProposalVotingPanelProps {
  /**
   * Proposals to render. The SDK exposes `approve_proposal` and
   * `execute_proposal` but no proposal listing, so the ids come from the
   * parent — an indexer query, or whatever already tracks them on-chain.
   */
  proposals: ProposalSummary[];
  /** Voting admin address. Defaults to the connected wallet's public key. */
  admin?: string;
  /** Signing keypair. Omit to sign with the connected wallet adapter. */
  source?: Keypair;
  /** Show an Execute control once a proposal has reached quorum. @default true */
  showExecute?: boolean;
  /** Routes the approval yourself instead of calling `approveProposal`. */
  onVote?: (proposalId: bigint) => void | Promise<void>;
  /** Routes the execution yourself instead of calling `executeProposal`. */
  onExecute?: (proposalId: bigint) => void | Promise<void>;
  /** Message shown when `proposals` is empty. @default 'No pending proposals.' */
  emptyMessage?: string;
  /** Optional container style. */
  style?: React.CSSProperties;
  /** Optional container CSS class. */
  className?: string;
}

const BUTTON_STYLE: React.CSSProperties = {
  padding: '6px 12px',
  backgroundColor: '#2563eb',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  fontWeight: 500,
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
};

const SECONDARY_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: '#ffffff',
  color: '#1f2937',
  border: '1px solid #d1d5db',
};

const DISABLED_BUTTON_STYLE: React.CSSProperties = {
  ...BUTTON_STYLE,
  backgroundColor: '#9ca3af',
  cursor: 'not-allowed',
};

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  backgroundColor: '#ffffff',
};

/** A proposal id is only usable as a `u64` if it parses as a positive integer. */
function toProposalBigInt(id: ProposalId): bigint | null {
  if (typeof id === 'bigint') return id > 0n ? id : null;
  if (typeof id === 'number') return Number.isInteger(id) && id > 0 ? BigInt(id) : null;
  return parsePositiveInteger(id);
}

function isReady(proposal: ProposalSummary): boolean {
  return (
    proposal.quorum !== undefined &&
    proposal.approvals !== undefined &&
    proposal.approvals >= proposal.quorum
  );
}

function statusOf(proposal: ProposalSummary): { label: string; variant: BadgeVariant } {
  if (proposal.executed) return { label: 'Executed', variant: 'success' };
  if (proposal.quorum !== undefined && proposal.approvals !== undefined) {
    return isReady(proposal)
      ? { label: 'Ready to execute', variant: 'success' }
      : { label: `${proposal.approvals} of ${proposal.quorum} approvals`, variant: 'warning' };
  }
  return { label: 'Pending', variant: 'default' };
}

/** Turns an SDK result into toast state, distinguishing revert from success. */
function toastFor(
  result: TransactionResult,
  failureMessage: (hash: string) => string,
): { status: TransactionToastStatus; hash?: string; message?: string } {
  return result.success
    ? { status: 'success', hash: result.hash }
    : { status: 'error', hash: result.hash, message: failureMessage(result.hash) };
}

/**
 * Multi-sig voting panel.
 *
 * Approve goes to `bcForgeClient.approveProposal` and Execute to
 * `bcForgeClient.executeProposal`, signed by the connected wallet adapter when
 * no `source` keypair is given. Rendered outside a `BcForgeProvider`, pass
 * `onVote` / `onExecute` to route the ids yourself; with neither available the
 * controls stay disabled rather than silently doing nothing.
 */
export const ProposalVotingPanel: React.FC<ProposalVotingPanelProps> = ({
  proposals,
  admin,
  source,
  showExecute = true,
  onVote,
  onExecute,
  emptyMessage = 'No pending proposals.',
  style,
  className,
}) => {
  const { connected, publicKey } = useWallet();
  const { approve, execute, pendingId, error, available } = useProposalVoting();

  const [toast, setToast] = useState<{
    status: TransactionToastStatus;
    hash?: string;
    message?: string;
  } | null>(null);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);

  const votingAdmin = admin ?? (connected ? (publicKey ?? undefined) : undefined);
  // A vote can be routed to the SDK (needs an admin address) or to an `onVote`
  // handler (which resolves the id itself). Without either route there is
  // nothing to do, so the controls stay disabled.
  const routeToSdk = available && onVote === undefined;
  const voteDisabled =
    !available && onVote === undefined ? true : routeToSdk && votingAdmin === undefined;
  const sdkUnavailable = !available && onVote === undefined;

  const guard = (proposal: ProposalSummary, needsAdmin: boolean) => {
    const bigintId = toProposalBigInt(proposal.id);
    if (bigintId === null) {
      setFailure({ id: String(proposal.id), message: 'Proposal id must be a positive integer.' });
      return null;
    }
    if (needsAdmin && !votingAdmin) {
      setFailure({ id: String(proposal.id), message: 'Connect a wallet or pass an admin address.' });
      return null;
    }
    return bigintId;
  };

  const handleVote = async (proposal: ProposalSummary) => {
    setFailure(null);
    if (onVote) {
      const bigintId = guard(proposal, false);
      if (bigintId === null) return;
      setToast({ status: 'pending' });
      try {
        await onVote(bigintId);
        setToast({ status: 'success' });
      } catch (err) {
        setToast({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const bigintId = guard(proposal, true);
    if (bigintId === null) return;
    setToast({ status: 'pending' });
    try {
      const result = await approve(votingAdmin as string, bigintId, source);
      setToast(toastFor(result, (hash) => `Approval failed with transaction hash: ${hash}`));
    } catch (err) {
      setFailure({
        id: String(proposal.id),
        message: err instanceof Error ? err.message : String(err),
      });
      setToast(null);
    }
  };

  const handleExecute = async (proposal: ProposalSummary) => {
    setFailure(null);
    if (onExecute) {
      const bigintId = guard(proposal, false);
      if (bigintId === null) return;
      setToast({ status: 'pending' });
      try {
        await onExecute(bigintId);
        setToast({ status: 'success' });
      } catch (err) {
        setToast({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    const bigintId = guard(proposal, false);
    if (bigintId === null) return;
    setToast({ status: 'pending' });
    try {
      const result = await execute(bigintId, source);
      setToast(toastFor(result, (hash) => `Execution failed with transaction hash: ${hash}`));
    } catch (err) {
      setFailure({
        id: String(proposal.id),
        message: err instanceof Error ? err.message : String(err),
      });
      setToast(null);
    }
  };

  if (proposals.length === 0) {
    return (
      <div className={className} data-testid="proposal-voting-panel" style={style}>
        <div style={{ fontSize: 14, color: '#4b5563' }} data-testid="proposal-voting-empty">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div
      className={className}
      data-testid="proposal-voting-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'inherit',
        ...style,
      }}
    >
      {sdkUnavailable ? (
        <Alert variant="warning" title="SDK unavailable">
          Render inside a BcForgeProvider, or pass an onVote handler, to vote on-chain.
        </Alert>
      ) : null}

      {failure ? (
        <Alert variant="danger" title="Vote failed" onDismiss={() => setFailure(null)}>
          {`Proposal ${failure.id}: ${failure.message}`}
        </Alert>
      ) : error ? (
        <Alert variant="danger" title="Vote failed">
          {error.message}
        </Alert>
      ) : null}

      {toast ? (
        <TransactionToast status={toast.status} hash={toast.hash} label="Proposal" onDismiss={() => setToast(null)} />
      ) : null}

      {proposals.map((proposal) => {
        const key = String(proposal.id);
        const status = statusOf(proposal);
        const busy = pendingId === key;
        const done = Boolean(proposal.executed);
        const ready = isReady(proposal);
        const disabled = voteDisabled || busy || done;
        const executeDisabled = !ready || done || busy;

        return (
          <div key={key} style={ROW_STYLE} data-testid={`proposal-${key}`}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                Proposal #{key}
                {proposal.action ? ` · ${proposal.action}` : ''}
              </span>
              <Badge variant={status.variant}>{status.label}</Badge>
            </div>

            {proposal.description ? (
              <p style={{ margin: 0, fontSize: 13, color: '#4b5563' }}>{proposal.description}</p>
            ) : null}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void handleVote(proposal)}
                style={disabled ? DISABLED_BUTTON_STYLE : BUTTON_STYLE}
              >
                {busy ? 'Working…' : 'Approve'}
              </button>

              {showExecute ? (
                <button
                  type="button"
                  disabled={executeDisabled}
                  onClick={() => void handleExecute(proposal)}
                  style={executeDisabled ? DISABLED_BUTTON_STYLE : SECONDARY_BUTTON_STYLE}
                >
                  Execute
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
};
