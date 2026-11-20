// SPDX-License-Identifier: MIT
import React from "react";
import type { bcForgeClient } from "@bc-forge/sdk";
import { Alert } from "./Alert";
import {
  useVestingClaim,
  useVestingSchedule,
  type VestingClaimClientLike,
} from "../hooks";
import { theme } from "../theme";

export interface VestingScreenProps {
  /** Deployed vesting contract ID. */
  contractId: string;
  /** Beneficiary whose schedule is shown and who claims. */
  beneficiaryAddress: string;
  /** Client used to submit the claim transaction through the connected wallet adapter. */
  claimClient: VestingClaimClientLike;
  /** SDK client used to read the schedule (defaults to the provider client). */
  client?: bcForgeClient | null;
  /** Current ledger override (defaults to the client's latest ledger). */
  currentLedger?: number;
  style?: React.CSSProperties;
  className?: string;
}

/** Percentage (0-100) of `part` within `whole`, clamped. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

const card: React.CSSProperties = {
  border: `1px solid ${theme.primaryBorder}`,
  borderRadius: 8,
  padding: 12,
  flex: "1 1 140px",
};

export const VestingScreen: React.FC<VestingScreenProps> = ({
  contractId,
  beneficiaryAddress,
  claimClient,
  client,
  currentLedger,
  style,
  className,
}) => {
  const {
    data: schedule,
    loading,
    error: loadError,
    refetch,
  } = useVestingSchedule({
    client,
    beneficiary: beneficiaryAddress,
    vestingContractId: contractId,
    currentLedger,
  });
  const {
    isClaiming,
    error: claimError,
    claim,
  } = useVestingClaim(contractId, beneficiaryAddress, claimClient);
  const [claimHash, setClaimHash] = React.useState<string | null>(null);
  const error = claimError ?? loadError;

  const onClaim = async () => {
    setClaimHash(null);
    try {
      const res = await claim();
      if (res.success) {
        setClaimHash(res.hash ?? "confirmed");
        await refetch();
      }
    } catch {
      /* surfaced through `error` */
    }
  };

  if (!schedule) {
    return (
      <div className={className} style={style} aria-label="Vesting schedule">
        {error ? <Alert variant="danger">{error.message}</Alert> : null}
        <p>
          {loading
            ? "Loading vesting schedule..."
            : "No vesting schedule found."}
        </p>
      </div>
    );
  }

  const start = schedule.startLedger ?? 0;
  const end = schedule.endLedger ?? start;
  const cliff = schedule.cliffLedger ?? start;
  const now = currentLedger ?? Math.floor(Date.now() / 5000);
  const total = end - start;
  const cliffPct = percentOf(cliff - start, total);
  const elapsedPct = percentOf(now - start, total);
  const canClaim = schedule.claimableAmount > 0n && !isClaiming;

  return (
    <div className={className} style={style} aria-label="Vesting schedule">
      {error ? <Alert variant="danger">{error.message}</Alert> : null}
      <div
        role="progressbar"
        aria-label="Vesting progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(elapsedPct)}
        style={{
          position: "relative",
          height: 12,
          borderRadius: 6,
          background: theme.primaryBackground,
          margin: "12px 0",
        }}
      >
        <div
          style={{
            width: `${elapsedPct}%`,
            height: "100%",
            borderRadius: 6,
            background: theme.primaryText,
          }}
        />
        <div
          data-testid="cliff-marker"
          style={{
            position: "absolute",
            left: `${cliffPct}%`,
            top: -2,
            bottom: -2,
            width: 2,
            background: theme.warningText,
          }}
        />
      </div>
      <p>
        Ledger {now} of {end} (cliff at {cliff}), {Math.round(elapsedPct)}%
        elapsed
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={card}>
          <div>Total Allocated</div>
          <strong>{schedule.totalLocked.toString()}</strong>
        </div>
        <div style={card}>
          <div>Vested</div>
          <strong>{schedule.vestedAmount.toString()}</strong>
        </div>
        <div style={card}>
          <div>Claimed</div>
          <strong>{schedule.releasedAmount.toString()}</strong>
        </div>
        <div style={card}>
          <div>Currently Claimable</div>
          <strong>{schedule.claimableAmount.toString()}</strong>
        </div>
      </div>
      <button
        type="button"
        onClick={onClaim}
        disabled={!canClaim}
        style={{ marginTop: 12 }}
      >
        {isClaiming ? "Claiming..." : "Claim Vested Tokens"}
      </button>
      {claimHash ? (
        <Alert variant="success">Claim submitted: {claimHash}</Alert>
      ) : null}
    </div>
  );
};
