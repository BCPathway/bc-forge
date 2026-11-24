// SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useState } from "react";
import type { bcForgeClient } from "@bc-forge/sdk";
import { Alert } from "./Alert";

export interface PausedBannerProps {
  /** Token client used to read the on-chain pause state. */
  client: Pick<bcForgeClient, "isPaused">;
  /** Background refresh interval in milliseconds. @default 30000 */
  pollIntervalMs?: number;
}

/** Persistent contract maintenance warning, mounted for all provider screens. */
export const PausedBanner: React.FC<PausedBannerProps> = ({
  client,
  pollIntervalMs = 30_000,
}) => {
  const [paused, setPaused] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      setPaused(await client.isPaused());
    } catch {
      return;
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const interval =
      pollIntervalMs > 0
        ? window.setInterval(() => void refresh(), pollIntervalMs)
        : null;
    window.addEventListener("focus", refresh);
    window.addEventListener("bcforge-paused-state-change", refresh);
    return () => {
      if (interval !== null) window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("bcforge-paused-state-change", refresh);
    };
  }, [pollIntervalMs, refresh]);

  if (!paused) return null;

  return (
    <div data-testid="paused-banner" style={{ padding: "0 16px" }}>
      <Alert variant="danger" title="Contract paused">
        Contract is currently paused for maintenance; writes are disabled.
      </Alert>
    </div>
  );
};
