// SPDX-License-Identifier: MIT
import React, { useState, useEffect } from 'react';
import { Role } from '@bc-forge/sdk';
import type { bcForgeClient } from '@bc-forge/sdk';
import { useBcForgeClient, truncatePublicKey } from '../context';
import { useWallet } from '../hooks';
import { Alert } from '../components/Alert';
import { Badge } from '../components/Badge';

export interface RolesScreenProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
}

/** All RBAC roles rendered as badges (#906). */
const ALL_ROLES: Role[] = [Role.Admin, Role.SuperAdmin, Role.Minter, Role.Pauser];

/** Fetches `hasRole` for every role against `target`. */
async function fetchRoleGrants(client: bcForgeClient, target: string): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    ALL_ROLES.map(async (role) => [role, await client.hasRole(role, target)] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Role management screen (#906). Shows `hasRole` badges for a typed target
 * address and offers grant/revoke actions for Minter and SuperAdmin, signed
 * by the connected wallet. Admin and Pauser are read-only badges because
 * `bcForgeClient` exposes no `grantAdmin` / grantPauser entry point here.
 */
export const RolesScreen: React.FC<RolesScreenProps> = ({ style, className }) => {
  const client = useBcForgeClient();
  const { publicKey, connected } = useWallet();

  const [target, setTarget] = useState('');
  const [roleState, setRoleState] = useState<Record<string, boolean> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const trimmedTarget = target.trim();
  const targetValid = trimmedTarget.length > 0;

  useEffect(() => {
    if (!targetValid) return;
    let cancelled = false;
    async function load() {
      try {
        const grants = await fetchRoleGrants(client, trimmedTarget);
        if (!cancelled) setRoleState(grants);
      } catch (err) {
        if (!cancelled) {
          setRoleState(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, targetValid, trimmedTarget, reloadKey]);

  const runAction = async (label: string, action: () => Promise<{ success: boolean; hash: string }>) => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const result = await action();
      if (result.success) {
        setSuccess(`${label} succeeded. Tx: ${result.hash}`);
        setReloadKey((key) => key + 1);
      } else {
        setError(`${label} failed with transaction hash: ${result.hash}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const actions: Array<{ label: string; run: () => Promise<{ success: boolean; hash: string }> }> = [
    { label: 'Grant Minter', run: () => client.grantMinter(trimmedTarget) },
    { label: 'Revoke Minter', run: () => client.revokeMinter(trimmedTarget) },
    { label: 'Grant Super Admin', run: () => client.grantSuperAdmin(trimmedTarget) },
    { label: 'Revoke Super Admin', run: () => client.revokeSuperAdmin(trimmedTarget) },
  ];

  const actionsDisabled = !connected || !targetValid || busy;

  const actionButtonStyle = (disabled: boolean): React.CSSProperties => ({
    padding: '8px 14px',
    backgroundColor: disabled ? '#9ca3af' : '#2563eb',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
  });

  return (
    <div
      className={className}
      data-testid="roles-screen"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        padding: '24px',
        maxWidth: '800px',
        margin: '0 auto',
        fontFamily: 'inherit',
        ...style,
      }}
    >
      <div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '24px', fontWeight: 700 }}>Role Management</h1>
        <p style={{ margin: 0, color: '#4b5563', fontSize: '14px' }}>
          Inspect and manage RBAC roles for a target address.
        </p>
      </div>

      <div style={{ fontSize: '14px', color: '#4b5563' }}>
        Signing account:{' '}
        <span data-testid="roles-connected-account" style={{ fontFamily: 'monospace' }}>
          {connected && publicKey ? truncatePublicKey(publicKey) : 'Not connected'}
        </span>
      </div>

      {error && (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert variant="success" title="Success" onDismiss={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          fontSize: '14px',
          maxWidth: '520px',
        }}
      >
        Target address
        <input
          type="text"
          name="target"
          placeholder="Target G... address"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            if (!e.target.value.trim()) setRoleState(null);
          }}
          style={{
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '14px',
            outline: 'none',
          }}
        />
      </label>

      <div data-testid="role-badges" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {!targetValid && (
          <span style={{ fontSize: '14px', color: '#6b7280' }}>
            Enter a target address to view roles.
          </span>
        )}
        {targetValid &&
          ALL_ROLES.map((role) => (
            <Badge
              key={role}
              data-testid={`role-badge-${role}`}
              variant={
                roleState === null
                  ? 'default'
                  : roleState[role]
                    ? 'success'
                    : 'default'
              }
            >
              {role}: {roleState === null ? '…' : roleState[role] ? 'Granted' : 'Not granted'}
            </Badge>
          ))}
      </div>

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            data-testid={action.label.toLowerCase().replace(/\s+/g, '-')}
            disabled={actionsDisabled}
            style={actionButtonStyle(actionsDisabled)}
            onClick={() => void runAction(action.label, action.run)}
          >
            {busy ? 'Working…' : action.label}
          </button>
        ))}
      </div>

      {!connected && (
        <span style={{ fontSize: '13px', color: '#6b7280' }}>
          Connect a wallet to grant or revoke roles.
        </span>
      )}
    </div>
  );
};
