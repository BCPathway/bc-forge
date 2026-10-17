// SPDX-License-Identifier: MIT
import React, { forwardRef } from 'react';
import { theme } from '../theme';

/** Rendered in place of a value that is missing or not a finite number. */
export const METRIC_VALUE_PLACEHOLDER = '—';

/** Values a metric card is able to display. */
export type MetricCardValue = string | number | bigint | null | undefined;

/** Sizing preset for a metric card. */
export type MetricCardSize = 'sm' | 'md' | 'lg';

/** Direction a metric is moving, derived from the sign of {@link MetricCardProps.delta}. */
export type MetricTrend = 'up' | 'down' | 'flat';

/**
 * Renders a metric value as display text.
 *
 * `bigint` is stringified directly: converting through `Number` would silently
 * drop precision above `2^53`, which is exactly where token balances and
 * stroop amounts live. `null`/`undefined` and non-finite numbers (a `0/0` ratio,
 * an `Infinity` share price) fall back to {@link METRIC_VALUE_PLACEHOLDER} so the
 * card never renders `NaN` to a user.
 */
export function formatMetricValue(value: MetricCardValue): string {
  if (value === null || value === undefined) return METRIC_VALUE_PLACEHOLDER;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : METRIC_VALUE_PLACEHOLDER;
  }
  return value;
}

/**
 * Formats a percentage delta, prefixing positive values with `+` so the sign
 * is unambiguous. Zero and non-finite inputs carry no sign.
 */
export function formatMetricDelta(delta: number, fractionDigits = 1): string {
  if (!Number.isFinite(delta)) return METRIC_VALUE_PLACEHOLDER;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(fractionDigits)}%`;
}

/**
 * Maps a delta to its trend: positive is `up`, negative is `down`, and `0`,
 * `null`, `undefined` and non-finite values are all `flat` — a metric with no
 * direction should not be coloured as a gain or a loss.
 */
export function getMetricTrend(delta: number | null | undefined): MetricTrend {
  if (delta === null || delta === undefined) return 'flat';
  if (!Number.isFinite(delta) || delta === 0) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

export interface MetricCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Heading of the metric, e.g. `'Total supply'`. */
  title: string;
  /** The metric itself. `null`/`undefined` render {@link METRIC_VALUE_PLACEHOLDER}. */
  value: MetricCardValue;
  /**
   * Percentage change against the previous period. The sign selects the trend
   * colour: positive uses the success tokens, negative the danger tokens and
   * zero the neutral ones.
   */
  delta?: number | null;
  /** Caption shown inside the delta badge, e.g. `'vs last week'`. */
  deltaLabel?: string;
  /** Secondary line under the value, e.g. a timestamp or a range. */
  subtitle?: React.ReactNode;
  /** Renders the skeleton state instead of the value. @default false */
  loading?: boolean;
  /** Text announced while the skeleton is showing. @default 'Loading…' */
  loadingLabel?: string;
  /** Sizing preset for the card and its typography. @default 'md' */
  size?: MetricCardSize;
}

export interface MetricStatBoxProps extends Omit<MetricCardProps, 'title' | 'size'> {
  /** Short label for the stat; renders as the card title. */
  label: string;
  /** Sizing preset for the stat box. @default 'sm' */
  size?: MetricCardSize;
}

const CARD_BASE_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid',
  borderRadius: 10,
  backgroundColor: theme.surface,
  color: theme.text,
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const SIZE_STYLES: Record<MetricCardSize, React.CSSProperties> = {
  sm: { padding: '10px 12px', gap: 2 },
  md: { padding: '14px 16px', gap: 4 },
  lg: { padding: '20px 24px', gap: 6 },
};

const TITLE_SIZE_STYLES: Record<MetricCardSize, React.CSSProperties> = {
  sm: { fontSize: 12 },
  md: { fontSize: 13 },
  lg: { fontSize: 14 },
};

const VALUE_SIZE_STYLES: Record<MetricCardSize, React.CSSProperties> = {
  sm: { fontSize: 20, lineHeight: 1.2 },
  md: { fontSize: 28, lineHeight: 1.2 },
  lg: { fontSize: 36, lineHeight: 1.15 },
};

const SUBTITLE_SIZE_STYLES: Record<MetricCardSize, React.CSSProperties> = {
  sm: { fontSize: 11 },
  md: { fontSize: 12 },
  lg: { fontSize: 13 },
};

const TREND_STYLES: Record<MetricTrend, React.CSSProperties> = {
  up: { backgroundColor: theme.successBackground, color: theme.successText },
  down: { backgroundColor: theme.dangerBackground, color: theme.dangerText },
  flat: { backgroundColor: theme.neutralBackground, color: theme.neutralText },
};

const DELTA_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};

const DELTA_BADGE_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  borderRadius: 10,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
};

const DELTA_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: theme.neutralText,
};

const SUBTITLE_STYLE: React.CSSProperties = {
  color: theme.neutralText,
};

const SKELETON_BAR_STYLE: React.CSSProperties = {
  borderRadius: 4,
  backgroundColor: theme.neutralBackground,
  height: 12,
};

const SKELETON_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingTop: 2,
};

/** Placeholder bars share the value's typography so the card does not jump when the real value lands. */
const SKELETON_VALUE_STYLE: React.CSSProperties = {
  ...SKELETON_BAR_STYLE,
  width: '55%',
  height: 28,
  marginTop: 2,
};

const SKELETON_SMALL_STYLE: React.CSSProperties = {
  ...SKELETON_BAR_STYLE,
  width: '35%',
  height: 10,
};

const SKELETON_WIDE_STYLE: React.CSSProperties = {
  ...SKELETON_BAR_STYLE,
  width: '70%',
  height: 10,
};

/**
 * Removes an element from both the visual and the accessibility trees while
 * keeping it in the DOM.
 */
const HIDDEN_STYLE: React.CSSProperties = {
  display: 'none',
};

/**
 * Standard visually-hidden pattern: off-screen but still announced, so the
 * skeleton state can expose a readable loading label.
 */
const VISUALLY_HIDDEN_STYLE: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

/**
 * Metric tile for dashboards: a title, a large value, an optional delta badge
 * and a secondary subtitle (#1166).
 *
 * The sign of `delta` picks the trend colours — positive renders on the success
 * tokens, negative on the danger tokens and zero on the neutral ones — and the
 * badge itself carries an arrow glyph that is hidden from assistive technology
 * so the sign is announced once, through the formatted percentage.
 *
 * While `loading` is true the card shows a skeleton of placeholder bars, sets
 * `aria-busy="true"`, and keeps the real value out of both the visual and the
 * accessibility trees so a screen reader never announces a stale figure behind
 * the placeholder.
 */
export const MetricCard = forwardRef<HTMLDivElement, MetricCardProps>(function MetricCard(
  {
    title,
    value,
    delta,
    deltaLabel,
    subtitle,
    loading = false,
    loadingLabel = 'Loading…',
    size = 'md',
    style,
    ...rest
  },
  ref,
) {
  const trend = getMetricTrend(delta);
  // Formatted up front so the badge renders from a plain string and a missing
  // delta needs no narrowing at the call site.
  const formattedDelta =
    delta !== null && delta !== undefined && Number.isFinite(delta)
      ? formatMetricDelta(delta)
      : null;

  return (
    <div
      ref={ref}
      data-testid="metric-card"
      aria-busy={loading}
      style={{ ...CARD_BASE_STYLE, ...SIZE_STYLES[size], ...style }}
      {...rest}
    >
      <span
        data-testid="metric-card-title"
        style={{
          fontSize: TITLE_SIZE_STYLES[size].fontSize,
          fontWeight: 500,
          color: theme.neutralText,
        }}
      >
        {title}
      </span>

      <span
        data-testid="metric-card-value"
        aria-hidden={loading ? true : undefined}
        style={{
          display: 'block',
          fontWeight: 700,
          color: theme.text,
          fontVariantNumeric: 'tabular-nums',
          wordBreak: 'break-all',
          ...VALUE_SIZE_STYLES[size],
          ...(loading ? HIDDEN_STYLE : {}),
        }}
      >
        {formatMetricValue(value)}
      </span>

      {loading ? (
        <div data-testid="metric-card-skeleton" style={SKELETON_STYLE}>
          <div data-testid="metric-card-skeleton-bar" style={SKELETON_VALUE_STYLE} />
          <div data-testid="metric-card-skeleton-bar" style={SKELETON_SMALL_STYLE} />
          <div data-testid="metric-card-skeleton-bar" style={SKELETON_WIDE_STYLE} />
          <span role="status" style={VISUALLY_HIDDEN_STYLE}>
            {`${title}: ${loadingLabel}`}
          </span>
        </div>
      ) : null}

      {!loading && formattedDelta !== null ? (
        <span data-testid="metric-card-delta-row" style={DELTA_ROW_STYLE}>
          <span
            data-testid="metric-card-delta"
            data-trend={trend}
            style={{ ...DELTA_BADGE_STYLE, ...TREND_STYLES[trend] }}
          >
            <span aria-hidden="true">{trend === 'up' ? '▲' : trend === 'down' ? '▼' : '■'}</span>
            {formattedDelta}
          </span>
          {deltaLabel ? (
            <span data-testid="metric-card-delta-label" style={DELTA_LABEL_STYLE}>
              {deltaLabel}
            </span>
          ) : null}
        </span>
      ) : null}

      {!loading && subtitle ? (
        <span
          data-testid="metric-card-subtitle"
          style={{
            ...SUBTITLE_STYLE,
            fontSize: SUBTITLE_SIZE_STYLES[size].fontSize,
          }}
        >
          {subtitle}
        </span>
      ) : null}
    </div>
  );
});

/**
 * Compact stat box (#1166) — the same metric tile as {@link MetricCard} with a
 * short `label` in place of a `title`, defaulted to the `sm` sizing so it can be
 * dropped inline next to a table or inside a card header.
 */
export const MetricStatBox = forwardRef<HTMLDivElement, MetricStatBoxProps>(function MetricStatBox(
  { label, size = 'sm', ...rest },
  ref,
) {
  return <MetricCard ref={ref} title={label} size={size} {...rest} />;
});