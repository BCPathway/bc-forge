// SPDX-License-Identifier: MIT
import React, { useState } from "react";
import { Role } from "@bc-forge/sdk";
import type { TransactionResult } from "@bc-forge/sdk";
import { ConfirmationDialog } from "../components/ConfirmationDialog";
import { Dropdown } from "../components/Dropdown";
import { Alert } from "../components/Alert";

/** Roles the screen can grant through the SDK (#1227). */
export type GrantableRole = Role.Minter | Role.SuperAdmin;

const GRANTABLE_ROLES: Array<{ label: string; value: GrantableRole }> = [
  { label: "Minter", value: Role.Minter },
  { label: "Super Admin", value: Role.SuperAdmin },
];

export interface GrantRoleModalProps {
  /** Whether the modal is shown. */
  open: boolean;
  /** Address that will receive the role. */
  target: string;
  /** Called on cancel or after a successful grant. */
  onClose: () => void;
  /** Executes the grant for the chosen role; rejections are shown inline. */
  onGrant: (role: GrantableRole, target: string) => Promise<TransactionResult>;
  /** Called with the transaction result after a successful grant. */
  onGranted?: (role: GrantableRole, result: TransactionResult) => void;
}

/**
 * Dialog for granting a role to `target` (#1227). The user picks a role from
 * a dropdown; submit calls `onGrant`. State: `role` (selection), `busy`
 * (in-flight tx), `error` (rejection or failed tx message).
 */
export const GrantRoleModal: React.FC<GrantRoleModalProps> = ({
  open,
  target,
  onClose,
  onGrant,
  onGranted,
}) => {
  const [role, setRole] = useState<GrantableRole>(Role.Minter);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const result = await onGrant(role, target);
      if (result.success) {
        onGranted?.(role, result);
        onClose();
      } else {
        setError(`Grant failed with transaction hash: ${result.hash}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isSuperAdmin = role === Role.SuperAdmin;

  return (
    <ConfirmationDialog
      open={open}
      onClose={() => {
        setError(null);
        onClose();
      }}
      onConfirm={() => {
        void submit();
      }}
      title={isSuperAdmin ? "Grant SuperAdmin access?" : "Grant role"}
      description={
        isSuperAdmin
          ? "This transfers full governance control over role assignments for the contract."
          : `Grant a role to ${target}.`
      }
      variant={isSuperAdmin ? "danger" : "warning"}
      confirmationMode={isSuperAdmin ? "checkbox" : "none"}
      confirmationLabel={
        isSuperAdmin
          ? "I verified the target address and reviewed the security checklist."
          : undefined
      }
      confirmLabel={isSuperAdmin ? "Grant SuperAdmin" : "Grant"}
      busyLabel="Granting…"
      busy={busy}
    >
      <div
        data-testid="grant-role-modal"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Dropdown
          aria-label="Role"
          data-testid="grant-role-dropdown"
          items={GRANTABLE_ROLES}
          value={role}
          onChange={(item) => setRole(item.value as GrantableRole)}
          disabled={busy}
          placeholder="Select role"
        />
        {isSuperAdmin && (
          <ul>
            <li>The recipient can grant and revoke privileged roles.</li>
            <li>
              Only proceed after verifying the target address with the
              recipient.
            </li>
          </ul>
        )}
        {error && (
          <Alert variant="danger" title="Error">
            {error}
          </Alert>
        )}
      </div>
    </ConfirmationDialog>
  );
};
