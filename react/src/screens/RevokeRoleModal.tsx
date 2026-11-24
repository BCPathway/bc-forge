// SPDX-License-Identifier: MIT
import React, { useState } from "react";
import { Role } from "@bc-forge/sdk";
import type { TransactionResult } from "@bc-forge/sdk";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Alert } from "../components/Alert";

/** Roles the screen can revoke through the SDK (#1228). */
export type RevocableRole = Role.Minter | Role.SuperAdmin;

export interface RevokeRoleModalProps {
  /** Whether the modal is shown. */
  open: boolean;
  /** Role being revoked. */
  role: RevocableRole;
  /** Address losing the role. */
  target: string;
  /** Called on cancel or after a successful revoke. */
  onClose: () => void;
  /** Executes the revoke; rejections are shown inline. */
  onRevoke: (role: RevocableRole, target: string) => Promise<TransactionResult>;
  /** Called with the transaction result after a successful revoke. */
  onRevoked?: (role: RevocableRole, result: TransactionResult) => void;
}

const IMPACT: Record<RevocableRole, string> = {
  [Role.Minter]:
    "This address will immediately lose the ability to mint tokens.",
  [Role.SuperAdmin]:
    "This address will immediately lose all super admin privileges, including managing other roles. Never revoke the last active super admin: the contract could be left without governance.",
};

/**
 * Confirmation dialog for revoking a role (#1228). Shows an impact warning
 * and requires the user to tick an acknowledgement before `onRevoke` runs.
 * State: `busy` (in-flight tx), `error` (rejection or failed tx message).
 */
export const RevokeRoleModal: React.FC<RevokeRoleModalProps> = ({
  open,
  role,
  target,
  onClose,
  onRevoke,
  onRevoked,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await onRevoke(role, target);
      if (result.success) {
        onRevoked?.(role, result);
        onClose();
      } else {
        setError(`Revoke failed with transaction hash: ${result.hash}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmationDialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      onConfirm={() => void confirm()}
      title={`Revoke ${role}`}
      description={`Revoke the ${role} role from ${target}. ${IMPACT[role]}`}
      variant="danger"
      confirmationMode="checkbox"
      confirmationLabel="I understand this address will lose these permissions."
      confirmLabel="Revoke"
      busyLabel="Revoking…"
      busy={busy}
    >
      {error && (
        <Alert variant="danger" title="Error">
          {error}
        </Alert>
      )}
    </ConfirmationDialog>
  );
};
