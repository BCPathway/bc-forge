// SPDX-License-Identifier: MIT
import React, { useState, useEffect } from "react";
import { Role } from "@bc-forge/sdk";
import type { bcForgeClient, TransactionResult } from "@bc-forge/sdk";
import { useBcForgeClient, truncatePublicKey } from "../context";
import { useProposalVote, useWallet } from "../hooks";
import { Alert } from "../components/Alert";
import { Badge } from "../components/Badge";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { theme } from "../theme";
import { GrantRoleModal } from "./GrantRoleModal";
import type { GrantableRole } from "./GrantRoleModal";
import { RevokeRoleModal } from "./RevokeRoleModal";
import type { RevocableRole } from "./RevokeRoleModal";
import { ProposalVotingPanel } from "../components/ProposalVotingPanel";
import type { ProposalSummary } from "../components/ProposalVotingPanel";
import { exportRbacReport } from "../utils";
import type { RbacReportFormat } from "../utils";

export interface RolesScreenProps {
  /** Optional container style */
  style?: React.CSSProperties;
  /** Optional container CSS class */
  className?: string;
  /** Debounce delay in ms before a typed address is looked up. @default 400 */
  debounceMs?: number;
}

/** All RBAC roles rendered as cards and badges (#906, #1224). */
const ALL_ROLES: Role[] = [
  Role.Admin,
  Role.SuperAdmin,
  Role.Minter,
  Role.Pauser,
];

/** Description and permission summary shown on each role card (#1224). */
const ROLE_INFO: Record<string, { description: string; permissions: string }> =
  {
    [Role.Admin]: {
      description: "Contract administrator.",
      permissions: "Configure the contract and manage roles.",
    },
    [Role.SuperAdmin]: {
      description: "Highest authority.",
      permissions: "Grant and revoke every role, including other super admins.",
    },
    [Role.Minter]: {
      description: "Token issuer.",
      permissions: "Mint new tokens.",
    },
    [Role.Pauser]: {
      description: "Emergency operator.",
      permissions: "Pause and unpause the contract.",
    },
  };

/** Permission summary shown as the tooltip on each role badge (#1226). */
const ROLE_PERMISSIONS: Record<string, string> = {
  [Role.Admin]: "Admin: configures the contract and manages roles.",
  [Role.SuperAdmin]:
    "SuperAdmin: highest authority; grants and revokes every role.",
  [Role.Minter]: "Minter: can mint new tokens.",
  [Role.Pauser]: "Pauser: can pause and unpause the contract in an emergency.",
};

/** Stellar public key (G... strkey) shape check. */
const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

/** Returns true when `value` is a well-formed Stellar `G...` address. */
function isValidStellarAddress(value: string): boolean {
  return STELLAR_ADDRESS.test(value);
}

/** Fetches `hasRole` for every role against `target`. */
export async function fetchRoleGrants(
  client: bcForgeClient,
  target: string,
): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    ALL_ROLES.map(
      async (role) => [role, await client.hasRole(role, target)] as const,
    ),
  );
  return Object.fromEntries(entries);
}

const buttonStyle = (
  disabled: boolean,
  danger = false,
): React.CSSProperties => ({
  padding: "8px 14px",
  backgroundColor: disabled ? "#6b7280" : danger ? theme.danger : theme.primary,
  color: theme.surface,
  border: "none",
  borderRadius: "6px",
  fontWeight: 500,
  cursor: disabled ? "not-allowed" : "pointer",
});

const actionButtonStyle = (disabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  backgroundColor: disabled ? "#9ca3af" : "#2563eb",
  color: "#ffffff",
  border: "none",
  borderRadius: "6px",
  fontWeight: 500,
  cursor: disabled ? "not-allowed" : "pointer",
});

/**
 * Role management dashboard (#906, #1224, #1225, #1227, #1228, #1231, #1232, #1233).
 */
export const RolesScreen: React.FC<RolesScreenProps> = ({
  style,
  className,
  debounceMs = 400,
}) => {
  const client = useBcForgeClient();
  const { publicKey, connected } = useWallet();
  const { vote } = useProposalVote();

  const [target, setTarget] = useState("");
  const [debouncedTarget, setDebouncedTarget] = useState("");
  const [roleState, setRoleState] = useState<Record<string, boolean> | null>(
    null,
  );
  const [adminAccount, setAdminAccount] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeRole, setRevokeRole] = useState<RevocableRole | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [reportFormat, setReportFormat] = useState<RbacReportFormat>("csv");
  const [busy, setBusy] = useState(false);

  const [proposals, setProposals] = useState<ProposalSummary[]>([]);
  const [proposalRole, setProposalRole] = useState<Role>(Role.Minter);

  const [canManagePause, setCanManagePause] = useState(false);
  const [paused, setPaused] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);

  const trimmedTarget = target.trim();
  const targetValid = isValidStellarAddress(trimmedTarget);
  const targetInvalid = trimmedTarget.length > 0 && !targetValid;

  const handleExport = async () => {
    if (!roleState || !targetValid) return;
    setError(null);
    try {
      const events =
        typeof (client as unknown as { getEvents?: () => Promise<unknown[]> })
          .getEvents === "function"
          ? await (
              client as unknown as { getEvents: () => Promise<unknown[]> }
            ).getEvents()
          : [];
      const report = exportRbacReport(
        trimmedTarget,
        roleState,
        events,
        reportFormat,
      );
      const url = URL.createObjectURL(
        new Blob([report.content], { type: report.mimeType }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = report.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    if (!targetValid) return;
    const id = setTimeout(() => setDebouncedTarget(trimmedTarget), debounceMs);
    return () => clearTimeout(id);
  }, [targetValid, trimmedTarget, debounceMs]);

  useEffect(() => {
    if (!debouncedTarget || debouncedTarget !== trimmedTarget) return;
    let cancelled = false;
    async function load() {
      try {
        const grants = await fetchRoleGrants(client, debouncedTarget);
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
  }, [client, debouncedTarget, trimmedTarget, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    async function check(key: string | null) {
      if (!key) {
        setAdminAccount(null);
        return;
      }
      try {
        const [isAdmin, isSuperAdmin] = await Promise.all([
          client.hasRole(Role.Admin, key),
          client.hasRole(Role.SuperAdmin, key),
        ]);
        if (!cancelled) setAdminAccount(isAdmin || isSuperAdmin ? key : null);
      } catch {
        if (!cancelled) setAdminAccount(null);
      }
    }
    void check(publicKey);
    return () => {
      cancelled = true;
    };
  }, [client, connected, publicKey, reloadKey]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setCanManagePause(false);
      return;
    }
    const walletAddress = publicKey;
    let cancelled = false;
    async function loadPauseAccess() {
      try {
        const [currentState, isPauser, isAdmin] = await Promise.all([
          client.isPaused(),
          client.hasRole(Role.Pauser, walletAddress),
          client.hasRole(Role.Admin, walletAddress),
        ]);
        if (!cancelled) {
          setPaused(currentState);
          setCanManagePause(isPauser || isAdmin);
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadPauseAccess();
    return () => {
      cancelled = true;
    };
  }, [client, connected, publicKey, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadProposals() {
      try {
        const pendingIds: bigint[] = [];
        const approvedIds: bigint[] = [];
        let cursor: bigint | number = 0;
        let nextCursor: bigint | null;
        do {
          const lists = await client.listLegacyProposals(cursor);
          pendingIds.push(...lists.pendingIds);
          approvedIds.push(...lists.approvedIds);
          nextCursor = lists.nextCursor;
          if (nextCursor !== null) cursor = nextCursor;
        } while (nextCursor !== null);
        if (!cancelled) {
          const details = await Promise.all(
            [...pendingIds, ...approvedIds].map(async (id) => {
              const detail = await client.getRoleProposal(id);
              return detail
                ? {
                    id,
                    action: `Grant ${detail.role}`,
                    description: detail.description,
                    approvals: detail.approvals,
                    quorum: detail.quorum,
                    executed: detail.executed,
                  }
                : null;
            }),
          );
          setProposals(
            details.flatMap((proposal) => (proposal ? [proposal] : [])),
          );
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadProposals();
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  const onDone = (label: string, result: TransactionResult) => {
    setSuccess(`${label} succeeded. Tx: ${result.hash}`);
    setReloadKey((key) => key + 1);
  };

  const grant = (role: GrantableRole, address: string) =>
    role === Role.Minter
      ? client.grantMinter(address)
      : client.grantSuperAdmin(address);

  const revoke = (role: RevocableRole, address: string) =>
    role === Role.Minter
      ? client.revokeMinter(address)
      : client.revokeSuperAdmin(address);

  const handleRevokeClick = async (role: Role) => {
    setError(null);
    setSuccess(null);
    if (role === Role.SuperAdmin) {
      let addresses: string[];
      try {
        const [pool, admin] = await Promise.all([
          client.getAdminPool(),
          client.getAdmin().catch(() => null),
        ]);
        addresses = Array.from(
          new Set([...pool, ...(admin ? [admin] : []), trimmedTarget]),
        );
      } catch {
        setError(
          "Unable to verify the active Super Admin count. Try again when the network is available.",
        );
        return;
      }
      try {
        const roles = await Promise.all(
          addresses.map((address) => client.hasRole(Role.SuperAdmin, address)),
        );
        const targetIsSuperAdmin = await client.hasRole(
          Role.SuperAdmin,
          trimmedTarget,
        );
        if (targetIsSuperAdmin && roles.filter(Boolean).length <= 1) {
          setError("Cannot revoke last active Super Admin");
          return;
        }
      } catch {
        setError(
          "Unable to verify the active Super Admin count. Try again when the network is available.",
        );
        return;
      }
      setBusy(true);
      try {
        const result = await client.revokeSuperAdmin(trimmedTarget);
        if (result.success) {
          setSuccess(`Revoke Super Admin succeeded. Tx: ${result.hash}`);
          setReloadKey((key) => key + 1);
        } else {
          setError(
            `Revoke Super Admin failed with transaction hash: ${result.hash}`,
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    setRevokeRole(role as RevocableRole);
  };

  const createRoleProposal = async () => {
    if (!publicKey || !targetValid) return;
    setError(null);
    setSuccess(null);
    if (roleState?.[proposalRole]) {
      setError(`Target already holds ${proposalRole}.`);
      return;
    }
    setBusy(true);
    try {
      const result = await client.createRoleProposal(
        publicKey,
        proposalRole,
        trimmedTarget,
        `Grant ${proposalRole} to ${trimmedTarget}`,
      );
      if (result.success) {
        const proposalId =
          result.returnValue === undefined
            ? ""
            : ` #${String(result.returnValue)}`;
        setSuccess(`Proposal${proposalId} created. Tx: ${result.hash}`);
        setReloadKey((key) => key + 1);
      } else {
        setError(
          `Proposal creation failed with transaction hash: ${result.hash}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const togglePause = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const result = paused ? await client.unpause() : await client.pause();
      if (result.success) {
        setPaused(!paused);
        setSuccess(
          `${paused ? "Unpause" : "Pause"} succeeded. Tx: ${result.hash}`,
        );
        setConfirmPause(false);
        setReloadKey((key) => key + 1);
        window.dispatchEvent(new Event("bcforge-paused-state-change"));
      } else {
        setError(
          `${paused ? "Unpause" : "Pause"} failed with transaction hash: ${result.hash}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const callerIsAdmin = connected && !!publicKey && adminAccount === publicKey;
  const canAct = connected && callerIsAdmin && targetValid;
  const heldCount =
    targetValid && roleState
      ? ALL_ROLES.filter((r) => roleState[r]).length
      : null;

  return (
    <div
      className={className}
      data-testid="roles-screen"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "24px",
        padding: "24px",
        maxWidth: "800px",
        margin: "0 auto",
        fontFamily: "inherit",
        color: theme.text,
        ...style,
      }}
    >
      <div>
        <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", fontWeight: 700 }}>
          Role Management
        </h1>
        <p style={{ margin: 0, color: theme.neutralText, fontSize: "14px" }}>
          Inspect and manage RBAC roles for a target address.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
        }}
      >
        <div style={{ fontSize: "14px", color: theme.neutralText }}>
          Signing account:{" "}
          <span
            data-testid="roles-connected-account"
            style={{ fontFamily: "monospace" }}
          >
            {connected && publicKey
              ? truncatePublicKey(publicKey)
              : "Not connected"}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <label
            htmlFor="export-format-select"
            style={{ fontSize: "13px", color: theme.neutralText }}
          >
            Format
          </label>
          <select
            id="export-format-select"
            aria-label="Export format"
            value={reportFormat}
            onChange={(e) =>
              setReportFormat(e.target.value as RbacReportFormat)
            }
            style={{
              padding: "4px 8px",
              border: `1px solid ${theme.border}`,
              borderRadius: "4px",
              fontSize: "13px",
              backgroundColor: theme.surface,
              color: theme.text,
            }}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
          <button
            type="button"
            data-testid="export-rbac-button"
            disabled={!targetValid || !roleState}
            style={buttonStyle(!targetValid || !roleState)}
            onClick={() => void handleExport()}
          >
            Export permissions
          </button>
        </div>
      </div>

      {error && (
        <Alert variant="danger" title="Error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      {success && (
        <Alert
          variant="success"
          title="Success"
          onDismiss={() => setSuccess(null)}
        >
          {success}
        </Alert>
      )}

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          fontSize: "14px",
          maxWidth: "520px",
        }}
      >
        Target address
        <input
          type="text"
          name="target"
          placeholder="Target G... address"
          value={target}
          onChange={(e) => {
            const next = e.target.value;
            setTarget(next);
            if (!next.trim()) {
              setDebouncedTarget("");
              setRoleState(null);
            }
          }}
          style={{
            padding: "8px 12px",
            border: `1px solid ${targetInvalid ? theme.danger : theme.border}`,
            borderRadius: "6px",
            fontSize: "14px",
            outline: "none",
            backgroundColor: theme.surface,
            color: theme.text,
          }}
        />
        {targetInvalid && (
          <span
            data-testid="target-error"
            style={{ fontSize: "12px", color: theme.danger }}
          >
            Enter a valid 56-character Stellar public key (starts with G).
          </span>
        )}
      </label>

      <div
        data-testid="role-cards"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "12px",
        }}
      >
        {ALL_ROLES.map((role) => (
          <div
            key={role}
            data-testid={`role-card-${role}`}
            style={{
              border: `1px solid ${theme.border}`,
              borderRadius: "8px",
              padding: "12px",
              backgroundColor: theme.surface,
              color: theme.text,
              display: "flex",
              flexDirection: "column",
              gap: "6px",
            }}
          >
            <strong>{role}</strong>
            <span style={{ fontSize: "13px", color: theme.neutralText }}>
              {ROLE_INFO[role]?.description}
            </span>
            <span style={{ fontSize: "12px", color: theme.neutralText }}>
              {ROLE_INFO[role]?.permissions}
            </span>
            <div>
              <Badge
                data-testid={`role-badge-${role}`}
                title={ROLE_PERMISSIONS[role]}
                data-status={
                  !targetValid
                    ? undefined
                    : roleState?.[role]
                      ? "granted"
                      : "not-granted"
                }
                variant={roleState && roleState[role] ? "success" : "default"}
              >
                {role}:{" "}
                {!targetValid
                  ? "—"
                  : roleState === null
                    ? "…"
                    : roleState[role]
                      ? "Granted"
                      : "Not granted"}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      {heldCount !== null && (
        <span
          data-testid="role-count"
          style={{ fontSize: "14px", color: theme.neutralText }}
        >
          Roles held: {heldCount} of {ALL_ROLES.length}
        </span>
      )}
      {!trimmedTarget && (
        <span style={{ fontSize: "14px", color: theme.neutralText }}>
          Enter a target address to view roles.
        </span>
      )}

      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
        <button
          type="button"
          data-testid="open-grant"
          disabled={!canAct || busy}
          style={buttonStyle(!canAct || busy)}
          onClick={() => setGrantOpen(true)}
        >
          Grant role
        </button>
        {([Role.Minter, Role.SuperAdmin] as const).map((role) => {
          const disabled =
            !connected ||
            !targetValid ||
            busy ||
            (roleState !== null && !roleState[role]);
          return (
            <button
              key={role}
              type="button"
              data-testid={`revoke-${role === Role.Minter ? "minter" : "super-admin"}`}
              disabled={disabled}
              style={buttonStyle(disabled, true)}
              onClick={() => void handleRevokeClick(role)}
            >
              Revoke {role === Role.Minter ? "Minter" : "Super Admin"}
            </button>
          );
        })}
      </div>

      <section
        aria-labelledby="role-proposal-heading"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <h2 id="role-proposal-heading" style={{ margin: 0, fontSize: 18 }}>
          Role grant proposals
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 14,
            }}
          >
            Role
            <select
              aria-label="Proposal role"
              value={proposalRole}
              onChange={(event) => setProposalRole(event.target.value as Role)}
              style={{
                padding: "6px 8px",
                border: "1px solid #d1d5db",
                borderRadius: 4,
                backgroundColor: theme.surface,
                color: theme.text,
              }}
            >
              <option value={Role.Minter}>Minter</option>
              <option value={Role.SuperAdmin}>Super Admin</option>
            </select>
          </label>
          <button
            type="button"
            data-testid="create-role-proposal"
            disabled={!connected || !targetValid || busy}
            style={actionButtonStyle(!connected || !targetValid || busy)}
            onClick={() => void createRoleProposal()}
          >
            {busy ? "Working…" : "Create Proposal"}
          </button>
        </div>
        <ProposalVotingPanel
          proposals={proposals}
          admin={publicKey ?? undefined}
          onVote={
            publicKey
              ? async (id) => {
                  const result = await vote(publicKey, id);
                  if (!result.success)
                    throw new Error(`Approval failed: ${result.hash}`);
                  setReloadKey((key) => key + 1);
                }
              : undefined
          }
          onExecute={
            publicKey
              ? async (id) => {
                  const result = await client.executeRoleProposal(
                    publicKey,
                    id,
                  );
                  if (!result.success)
                    throw new Error(`Execution failed: ${result.hash}`);
                  setReloadKey((key) => key + 1);
                }
              : undefined
          }
          emptyMessage="No pending proposals."
        />
      </section>

      {canManagePause ? (
        <section
          aria-label="Emergency pause controls"
          style={{ display: "flex", alignItems: "center", gap: 12 }}
        >
          <span data-testid="contract-pause-status">
            Contract is {paused ? "paused" : "active"}.
          </span>
          <button
            type="button"
            data-testid="toggle-contract-pause"
            disabled={busy}
            style={actionButtonStyle(busy)}
            onClick={() => setConfirmPause(true)}
          >
            {paused ? "Unpause Contract" : "Pause Contract"}
          </button>
        </section>
      ) : null}

      <ConfirmationDialog
        open={confirmPause}
        onClose={() => setConfirmPause(false)}
        onConfirm={() => void togglePause()}
        title={paused ? "Unpause contract?" : "Pause contract?"}
        description={
          paused
            ? "Resuming the contract will enable token writes again."
            : "Pausing the contract will disable token writes for users."
        }
        confirmLabel={paused ? "Unpause" : "Pause"}
        busy={busy}
        busyLabel={paused ? "Unpausing…" : "Pausing…"}
        variant="danger"
      />

      {!connected && (
        <span style={{ fontSize: "13px", color: theme.neutralText }}>
          Wallet not connected. Connect a wallet to grant or revoke roles.
        </span>
      )}

      <GrantRoleModal
        open={grantOpen}
        target={trimmedTarget}
        onClose={() => setGrantOpen(false)}
        onGrant={(role, address) => grant(role, address)}
        onGranted={(role, result) => onDone(`Grant ${role}`, result)}
      />

      {revokeRole && (
        <RevokeRoleModal
          open={Boolean(revokeRole)}
          role={revokeRole}
          target={trimmedTarget}
          onClose={() => setRevokeRole(null)}
          onRevoke={(role, address) => revoke(role, address)}
          onRevoked={(role, result) => onDone(`Revoke ${role}`, result)}
        />
      )}
    </div>
  );
};
