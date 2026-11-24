// SPDX-License-Identifier: MIT
import React, { useId, useMemo, useState } from "react";
import { theme } from "../theme";

export interface VestingChartProps {
  /** Total token amount in the vesting schedule (in base units). */
  totalAmount: bigint;
  /** Amount already claimed/released (in base units). */
  releasedAmount: bigint;
  /** Ledger sequence at which the cliff ends and unlocking begins. */
  cliffLedger: number;
  /** Ledger sequence at which 100% of tokens are vested. */
  endLedger: number;
  /** Current ledger sequence. */
  currentLedger: number;
  /** Optional start ledger for the schedule timeline. @default 0 */
  startLedger?: number;
  /** SVG viewBox width in pixels. @default 640 */
  width?: number;
  /** SVG viewBox height in pixels. @default 260 */
  height?: number;
  /** Accessible chart heading. @default 'Vesting Schedule' */
  title?: string;
  /** Custom formatter for token amounts. */
  formatAmount?: (amount: bigint) => string;
  /** Custom formatter for ledger numbers. */
  formatLedger?: (ledger: number) => string;
  /** Optional container CSS class. */
  className?: string;
  /** Optional container inline styles. */
  style?: React.CSSProperties;
}

export interface VestingMetrics {
  vestedAmount: bigint;
  claimedAmount: bigint;
  claimableAmount: bigint;
  lockedAmount: bigint;
  vestedPercent: number;
  claimedPercent: number;
  claimablePercent: number;
  isBeforeCliff: boolean;
  isFullyVested: boolean;
}

interface TooltipPoint {
  id: string;
  label: string;
  ledger: number;
  detail: string;
  x: number;
  y: number;
}

const PAD_LEFT = 56;
const PAD_RIGHT = 24;
const PAD_TOP = 24;
const PAD_BOTTOM = 40;

const CARD_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 16,
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  backgroundColor: theme.surface,
  color: theme.text,
  fontFamily: "inherit",
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  flexWrap: "wrap",
  gap: 8,
};

const LEGEND_STYLE: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 16,
  fontSize: 12,
  color: theme.neutralText,
};

const LEGEND_ITEM_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const TOOLTIP_BAR_STYLE: React.CSSProperties = {
  minHeight: 28,
  padding: "6px 10px",
  borderRadius: 6,
  backgroundColor: theme.neutralBackground,
  color: theme.text,
  fontSize: 12,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

function defaultFormatAmount(amount: bigint): string {
  return amount.toLocaleString("en-US");
}

function defaultFormatLedger(ledger: number): string {
  return `#${ledger.toLocaleString("en-US")}`;
}

function clampBigInt(value: bigint, min: bigint, max: bigint): bigint {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function bigintRatio(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  const clamped = clampBigInt(numerator, 0n, denominator);
  const scaled = (clamped * 10_000n) / denominator;
  return Number(scaled) / 10_000;
}

/**
 * Computes vested, claimed, claimable, and locked token amounts for a linear
 * cliff-vesting schedule.
 */
export function computeVestingMetrics(
  totalAmount: bigint,
  releasedAmount: bigint,
  cliffLedger: number,
  endLedger: number,
  currentLedger: number,
): VestingMetrics {
  const safeTotal = totalAmount > 0n ? totalAmount : 0n;
  const claimedAmount = clampBigInt(releasedAmount, 0n, safeTotal);

  let vestedAmount = 0n;
  if (safeTotal > 0n) {
    if (currentLedger >= endLedger) {
      vestedAmount = safeTotal;
    } else if (currentLedger >= cliffLedger) {
      const span = endLedger - cliffLedger;
      if (span <= 0) {
        vestedAmount = safeTotal;
      } else {
        const elapsed = currentLedger - cliffLedger;
        vestedAmount = (safeTotal * BigInt(elapsed)) / BigInt(span);
      }
    }
  }

  const claimableAmount =
    vestedAmount > claimedAmount ? vestedAmount - claimedAmount : 0n;
  const lockedAmount =
    safeTotal > vestedAmount ? safeTotal - vestedAmount : 0n;

  return {
    vestedAmount,
    claimedAmount,
    claimableAmount,
    lockedAmount,
    vestedPercent: Math.round(bigintRatio(vestedAmount, safeTotal) * 100),
    claimedPercent: Math.round(bigintRatio(claimedAmount, safeTotal) * 100),
    claimablePercent: Math.round(bigintRatio(claimableAmount, safeTotal) * 100),
    isBeforeCliff: currentLedger < cliffLedger,
    isFullyVested: currentLedger >= endLedger,
  };
}

/**
 * Responsive, accessible SVG visualization of a token vesting schedule with
 * cliff marker, unlock slope, and claimed vs. claimable zones.
 */
export function VestingChart({
  totalAmount,
  releasedAmount,
  cliffLedger,
  endLedger,
  currentLedger,
  startLedger = 0,
  width = 640,
  height = 260,
  title = "Vesting Schedule",
  formatAmount = defaultFormatAmount,
  formatLedger = defaultFormatLedger,
  className,
  style,
}: VestingChartProps): React.ReactElement {
  const titleId = useId();
  const descId = useId();
  const [activeTooltip, setActiveTooltip] = useState<TooltipPoint | null>(null);

  const metrics = useMemo(
    () =>
      computeVestingMetrics(
        totalAmount,
        releasedAmount,
        cliffLedger,
        endLedger,
        currentLedger,
      ),
    [totalAmount, releasedAmount, cliffLedger, endLedger, currentLedger],
  );

  const geometry = useMemo(() => {
    const plotWidth = Math.max(width - PAD_LEFT - PAD_RIGHT, 1);
    const plotHeight = Math.max(height - PAD_TOP - PAD_BOTTOM, 1);
    const baselineY = PAD_TOP + plotHeight;

    const minLedger = Math.min(startLedger, cliffLedger, endLedger, currentLedger);
    const maxLedger = Math.max(endLedger, cliffLedger, currentLedger, minLedger + 1);
    const ledgerSpan = maxLedger - minLedger;

    const xForLedger = (ledger: number): number =>
      PAD_LEFT + ((ledger - minLedger) / ledgerSpan) * plotWidth;

    const yForRatio = (ratio: number): number =>
      baselineY - Math.max(0, Math.min(1, ratio)) * plotHeight;

    const startX = xForLedger(minLedger);
    const cliffX = xForLedger(cliffLedger);
    const endX = xForLedger(endLedger);
    const currentX = xForLedger(
      Math.max(minLedger, Math.min(maxLedger, currentLedger)),
    );

    const safeTotal = totalAmount > 0n ? totalAmount : 0n;
    const vestedRatio = bigintRatio(metrics.vestedAmount, safeTotal);
    const claimedRatio = bigintRatio(metrics.claimedAmount, safeTotal);

    const vestedY = yForRatio(vestedRatio);
    const claimedY = yForRatio(claimedRatio);
    const topY = yForRatio(1);

    // Full unlock slope polyline: flat at 0 until cliff, then linear to endLedger, then flat at 100%
    const slopePoints = [
      `${startX.toFixed(2)},${baselineY.toFixed(2)}`,
      `${cliffX.toFixed(2)},${baselineY.toFixed(2)}`,
      `${endX.toFixed(2)},${topY.toFixed(2)}`,
    ];
    if (maxLedger > endLedger) {
      slopePoints.push(`${xForLedger(maxLedger).toFixed(2)},${topY.toFixed(2)}`);
    }

    // Claimable + Claimed area under the vesting curve up to currentLedger
    let vestedAreaPath = "";
    if (currentLedger > cliffLedger && safeTotal > 0n) {
      const clampedEndX = Math.min(currentX, endX);
      const pts: string[] = [
        `M ${cliffX.toFixed(2)} ${baselineY.toFixed(2)}`,
        `L ${clampedEndX.toFixed(2)} ${vestedY.toFixed(2)}`,
      ];
      if (currentX > endX) {
        pts.push(`L ${currentX.toFixed(2)} ${topY.toFixed(2)}`);
      }
      pts.push(`L ${currentX.toFixed(2)} ${baselineY.toFixed(2)}`, "Z");
      vestedAreaPath = pts.join(" ");
    }

    // Claimed zone: clipped horizontally at claimedY under the vesting curve up to currentLedger
    let claimedAreaPath = "";
    if (metrics.claimedAmount > 0n && safeTotal > 0n) {
      const claimStartX = Math.max(startX, cliffX);
      const claimEndX = Math.max(claimStartX, currentX);
      // Find where the slope reaches claimedRatio
      const slopeSpanX = Math.max(endX - cliffX, 0);
      const claimedSlopeX =
        slopeSpanX > 0 ? cliffX + slopeSpanX * claimedRatio : cliffX;
      const clampedSlopeX = Math.min(claimedSlopeX, claimEndX);

      claimedAreaPath = [
        `M ${cliffX.toFixed(2)} ${baselineY.toFixed(2)}`,
        `L ${clampedSlopeX.toFixed(2)} ${claimedY.toFixed(2)}`,
        `L ${claimEndX.toFixed(2)} ${claimedY.toFixed(2)}`,
        `L ${claimEndX.toFixed(2)} ${baselineY.toFixed(2)}`,
        "Z",
      ].join(" ");
    }

    const tooltips: TooltipPoint[] = [
      {
        id: "cliff",
        label: "Cliff",
        ledger: cliffLedger,
        detail: `Cliff at ledger ${formatLedger(cliffLedger)} — unlocking begins`,
        x: cliffX,
        y: baselineY,
      },
      {
        id: "current",
        label: "Current Ledger",
        ledger: currentLedger,
        detail: `Ledger ${formatLedger(currentLedger)}: ${formatAmount(metrics.vestedAmount)} vested (${metrics.vestedPercent}%), ${formatAmount(metrics.claimedAmount)} claimed, ${formatAmount(metrics.claimableAmount)} claimable`,
        x: currentX,
        y: vestedY,
      },
      {
        id: "end",
        label: "End",
        ledger: endLedger,
        detail: `Fully vested at ledger ${formatLedger(endLedger)}: ${formatAmount(safeTotal)}`,
        x: endX,
        y: topY,
      },
    ];

    return {
      plotWidth,
      plotHeight,
      baselineY,
      topY,
      startX,
      cliffX,
      endX,
      currentX,
      vestedY,
      claimedY,
      slopePoints: slopePoints.join(" "),
      vestedAreaPath,
      claimedAreaPath,
      tooltips,
    };
  }, [
    width,
    height,
    startLedger,
    cliffLedger,
    endLedger,
    currentLedger,
    totalAmount,
    metrics,
    formatAmount,
    formatLedger,
  ]);

  const summaryText = `Vesting schedule for ${formatAmount(totalAmount)} total tokens. Cliff at ledger ${formatLedger(cliffLedger)}, fully vested at ledger ${formatLedger(endLedger)}. Current ledger ${formatLedger(currentLedger)}: ${formatAmount(metrics.claimedAmount)} claimed (${metrics.claimedPercent}%), ${formatAmount(metrics.claimableAmount)} claimable (${metrics.claimablePercent}%), ${formatAmount(metrics.lockedAmount)} locked.`;

  return (
    <section
      aria-labelledby={titleId}
      className={className}
      style={{ ...CARD_STYLE, ...style }}
      data-testid="vesting-chart"
    >
      <div style={HEADER_STYLE}>
        <h3 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
          {title}
        </h3>
        <span style={{ fontSize: 13, color: theme.neutralText }}>
          {metrics.vestedPercent}% vested ({formatAmount(metrics.vestedAmount)} /{" "}
          {formatAmount(totalAmount)})
        </span>
      </div>

      <svg
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
      >
        <title>{title}</title>
        <desc id={descId}>{summaryText}</desc>

        {/* Horizontal gridlines */}
        {[0, 0.5, 1].map((ratio) => {
          const y = geometry.baselineY - ratio * geometry.plotHeight;
          return (
            <g key={ratio}>
              <line
                x1={PAD_LEFT}
                y1={y}
                x2={width - PAD_RIGHT}
                y2={y}
                stroke={theme.border}
                strokeDasharray={ratio === 0 ? undefined : "3 3"}
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={11}
                fill={theme.neutralText}
              >
                {Math.round(ratio * 100)}%
              </text>
            </g>
          );
        })}

        {/* Claimable zone (vested area under curve) */}
        {geometry.vestedAreaPath && (
          <path
            d={geometry.vestedAreaPath}
            fill={theme.warningBorder}
            fillOpacity={0.55}
            data-testid="vesting-claimable-zone"
          />
        )}

        {/* Claimed zone (released portion) */}
        {geometry.claimedAreaPath && (
          <path
            d={geometry.claimedAreaPath}
            fill={theme.successBorder}
            fillOpacity={0.85}
            data-testid="vesting-claimed-zone"
          />
        )}

        {/* Unlock slope line */}
        <polyline
          points={geometry.slopePoints}
          fill="none"
          stroke={theme.primary}
          strokeWidth={2.5}
          strokeLinejoin="round"
          data-testid="vesting-unlock-slope"
        />

        {/* Cliff marker */}
        <g data-testid="vesting-cliff-marker">
          <line
            x1={geometry.cliffX}
            y1={PAD_TOP}
            x2={geometry.cliffX}
            y2={geometry.baselineY}
            stroke={theme.danger}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
          <text
            x={geometry.cliffX}
            y={PAD_TOP - 6}
            textAnchor="middle"
            fontSize={11}
            fontWeight={600}
            fill={theme.dangerText}
          >
            Cliff ({formatLedger(cliffLedger)})
          </text>
        </g>

        {/* Current ledger vertical indicator */}
        <line
          x1={geometry.currentX}
          y1={PAD_TOP}
          x2={geometry.currentX}
          y2={geometry.baselineY}
          stroke={theme.primaryText}
          strokeWidth={1.5}
          strokeDasharray="2 2"
          data-testid="vesting-current-marker"
        />

        {/* Interactive accessible milestone points */}
        {geometry.tooltips.map((pt) => {
          const isSelected = activeTooltip?.id === pt.id;
          const fillColor =
            pt.id === "cliff"
              ? theme.danger
              : pt.id === "current"
                ? theme.primary
                : theme.successText;

          return (
            <circle
              key={pt.id}
              cx={pt.x}
              cy={pt.y}
              r={isSelected ? 7 : 5}
              fill={fillColor}
              stroke={theme.surface}
              strokeWidth={2}
              tabIndex={0}
              role="button"
              aria-label={`${pt.label}: ${pt.detail}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setActiveTooltip(pt)}
              onMouseLeave={() => setActiveTooltip(null)}
              onFocus={() => setActiveTooltip(pt)}
              onBlur={() => setActiveTooltip(null)}
              data-testid={`vesting-point-${pt.id}`}
            />
          );
        })}

        {/* X-axis ledger labels */}
        <text
          x={geometry.startX}
          y={height - 10}
          textAnchor="start"
          fontSize={11}
          fill={theme.neutralText}
        >
          {formatLedger(Math.min(startLedger, cliffLedger, endLedger, currentLedger))}
        </text>
        <text
          x={geometry.endX}
          y={height - 10}
          textAnchor="end"
          fontSize={11}
          fill={theme.neutralText}
        >
          {formatLedger(endLedger)}
        </text>
      </svg>

      {/* Accessible tooltip readout */}
      <div
        role="tooltip"
        aria-live="polite"
        style={TOOLTIP_BAR_STYLE}
        data-testid="vesting-tooltip"
      >
        <span>
          {activeTooltip
            ? activeTooltip.detail
            : `Hover or focus a milestone marker to inspect ledger details.`}
        </span>
      </div>

      {/* Legend */}
      <div style={LEGEND_STYLE} aria-label="Vesting breakdown">
        <span style={LEGEND_ITEM_STYLE}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: theme.successBorder,
              border: `1px solid ${theme.successText}`,
              display: "inline-block",
            }}
          />
          Claimed: {formatAmount(metrics.claimedAmount)}
        </span>
        <span style={LEGEND_ITEM_STYLE}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: theme.warningBorder,
              border: `1px solid ${theme.warningText}`,
              display: "inline-block",
            }}
          />
          Claimable: {formatAmount(metrics.claimableAmount)}
        </span>
        <span style={LEGEND_ITEM_STYLE}>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: theme.neutralBackground,
              border: `1px solid ${theme.border}`,
              display: "inline-block",
            }}
          />
          Locked: {formatAmount(metrics.lockedAmount)}
        </span>
      </div>
    </section>
  );
}
