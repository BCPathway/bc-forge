// SPDX-License-Identifier: MIT
import React, { forwardRef } from "react";
import { theme } from "../theme";

export interface FooterProps extends React.HTMLAttributes<HTMLElement> {
  network?: string;
  latencyMs?: number | null;
  latencyWarningMs?: number;
  latencyErrorMs?: number;
}

export const Footer = forwardRef<HTMLElement, FooterProps>(function Footer(
  {
    network = "Network",
    latencyMs,
    latencyWarningMs = 300,
    latencyErrorMs = 1000,
    children,
    style,
    ...rest
  },
  ref,
) {
  const hasLatency =
    typeof latencyMs === "number" &&
    Number.isFinite(latencyMs) &&
    latencyMs >= 0;
  const color = !hasLatency
    ? theme.neutralText
    : latencyMs! >= latencyErrorMs
      ? theme.danger
      : latencyMs! >= latencyWarningMs
        ? "#b45309"
        : "#15803d";
  const latencyLabel = hasLatency
    ? `${Math.round(latencyMs!)} ms`
    : "Unavailable";

  return (
    <footer
      ref={ref}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 16px",
        borderTop: `1px solid ${theme.border}`,
        backgroundColor: theme.surface,
        color: theme.neutralText,
        fontSize: 13,
        ...style,
      }}
      {...rest}
    >
      <div>{children}</div>
      <div
        role="status"
        aria-label={`${network} network latency`}
        style={{ display: "inline-flex", alignItems: "center", gap: 7 }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
        <span>{network}</span>
        <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
          {latencyLabel}
        </span>
      </div>
    </footer>
  );
});
