// SPDX-License-Identifier: MIT
import React, { useCallback, useEffect, useState } from 'react';
import { calculateApy } from '@bc-forge/sdk';
import type { ApyOptions, ApyResult } from '@bc-forge/sdk';

import { formatApy } from '../utils';
import { Alert } from './Alert';

/** One labelled sample of the series the chart plots. */
export interface ApyChartPoint {
  /** Axis label, e.g. a date or ledger sequence. */
  label: string;
  /** Value as a decimal fraction, matching `calculateApy`'s `apy`. */
  value: number;
}

export interface APYChartProps {
  /**
   * The series to plot. Takes precedence over `result` and `options`, and is
   * the escape hatch when the parent has already assembled the history.
   */
  points?: ApyChartPoint[];
  /** A {@link ApyResult} from `calculateApy`; plots the current reading. */
  result?: ApyResult | null;
  /**
   * When set, and neither `points` nor `result` is supplied, the chart calls
   * `calculateApy` itself and renders the loading, error and retry states.
   */
  options?: ApyOptions;
  /** Chart height in pixels. @default 180 */
  height?: number;
  /** Chart width in pixels. @default 640 */
  width?: number;
  /** Heading shown above the plot. @default 'Vault APY' */
  title?: string;
  /** Formats each value for the axis and the headline. Defaults to `formatApy`. */
  formatValue?: (value: number) => string;
  /** Message shown when there is nothing to plot. @default 'No APY data available.' */
  emptyMessage?: string;
  /** Optional container style. */
  style?: React.CSSProperties;
  /** Optional container CSS class. */
  className?: string;
}

const PLOT_PADDING = 8;

const CARD_STYLE: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  backgroundColor: '#f9fafb',
  fontFamily: 'inherit',
};

const CAPTION_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12,
  color: '#6b7280',
};

const AXIS_LABEL_STYLE: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

function extent(values: number[]): { min: number; max: number; flat: boolean } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, flat: max === min };
}

/**
 * Projects the series into a `viewBox` polyline. A single point is centred, and
 * a series with no variation is drawn flat through the middle rather than
 * dividing by a zero span.
 */
function toPolyline(
  points: ApyChartPoint[],
  width: number,
  height: number,
): { polyline: string; yForValue: (value: number) => number; xForIndex: (index: number) => number } {
  const { min, max, flat } = extent(points.map((p) => p.value));
  const span = flat ? 1 : max - min;
  const drawableWidth = width - PLOT_PADDING * 2;
  const drawableHeight = height - PLOT_PADDING * 2;
  const step = points.length > 1 ? drawableWidth / (points.length - 1) : 0;

  const xForIndex = (index: number) =>
    points.length > 1 ? PLOT_PADDING + step * index : width / 2;
  const yForValue = (value: number) =>
    PLOT_PADDING + drawableHeight * (1 - (flat ? 0.5 : (value - min) / span));

  const polyline = points
    .map((point, index) => `${xForIndex(index).toFixed(2)},${yForValue(point.value).toFixed(2)}`)
    .join(' ');

  return { polyline, yForValue, xForIndex };
}

/** Closed path of the same series, filled down to the baseline. */
function toAreaPath(
  polyline: string,
  points: ApyChartPoint[],
  width: number,
  height: number,
): string {
  if (points.length < 2) return '';
  const baseline = height - PLOT_PADDING;
  return `M ${polyline.replace(/ /g, ' L ')} L ${width - PLOT_PADDING},${baseline} L ${PLOT_PADDING},${baseline} Z`;
}

/**
 * `calculateApy` reports a single annualised figure, so a result plots as one
 * reading. Build a real series by sampling `calculateApy` over time and
 * passing `points`.
 */
function pointsFromResult(result: ApyResult): ApyChartPoint[] {
  return [{ label: `Ledger ${result.current.ledger}`, value: result.apy }];
}

/**
 * Sparkline of a vault's annualised yield.
 *
 * Supply the series one of three ways: a `points` array when the parent has
 * the history, a `result` straight from `calculateApy`, or `options` to let
 * the chart call `calculateApy` itself. The APY maths is never reimplemented
 * here — the component only draws values it is given.
 *
 * The plot is an inline SVG exposed as a single `role="img"` with a summary
 * label, with the latest, min and max also rendered as text.
 */
export const APYChart: React.FC<APYChartProps> = ({
  points,
  result,
  options,
  height = 180,
  width = 640,
  title = 'Vault APY',
  formatValue = formatApy,
  emptyMessage = 'No APY data available.',
  style,
  className,
}) => {
  const [fetched, setFetched] = useState<ApyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  const shouldFetch = !points && !result && Boolean(options);

  const load = useCallback(async () => {
    if (!options) return;
    try {
      setLoading(true);
      setError(null);
      setFetched(await calculateApy(options));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => {
    if (!shouldFetch) return;
    void (async () => {
      await load();
    })();
  }, [shouldFetch, load, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const activeResult = result ?? fetched ?? undefined;
  const source = points ?? (activeResult ? pointsFromResult(activeResult) : undefined);
  const usable = (source ?? []).filter((point) => Number.isFinite(point.value));

  if (shouldFetch && loading && usable.length === 0) {
    return (
      <div className={className} data-testid="apy-chart" style={style}>
        <div style={{ fontSize: 14, color: '#4b5563' }}>Loading APY…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={className} data-testid="apy-chart" style={style}>
        <Alert variant="danger" title="APY unavailable">
          {error.message}
        </Alert>
        <button
          type="button"
          onClick={retry}
          style={{
            marginTop: 8,
            padding: '6px 12px',
            backgroundColor: '#ffffff',
            color: '#374151',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (usable.length === 0) {
    return (
      <div className={className} data-testid="apy-chart" style={style}>
        <div style={{ fontSize: 14, color: '#4b5563' }} data-testid="apy-chart-empty">
          {emptyMessage}
        </div>
      </div>
    );
  }

  const { min, max } = extent(usable.map((p) => p.value));
  const latest = usable[usable.length - 1];
  const { polyline, yForValue, xForIndex } = toPolyline(usable, width, height);
  const areaPath = toAreaPath(polyline, usable, width, height);
  const summary = `${title}: ${usable.length} point${usable.length === 1 ? '' : 's'} from ${formatValue(
    min,
  )} to ${formatValue(max)}, latest ${formatValue(latest.value)}`;

  return (
    <div className={className} data-testid="apy-chart" style={{ ...CARD_STYLE, ...style }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span style={AXIS_LABEL_STYLE}>{title}</span>
        <span data-testid="apy-chart-latest" style={{ fontSize: 20, fontWeight: 600 }}>
          {formatValue(latest.value)}
        </span>
      </div>

      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {areaPath ? <path d={areaPath} fill="rgba(37, 99, 235, 0.12)" /> : null}
        {usable.length === 1 ? (
          <line
            x1={PLOT_PADDING}
            y1={yForValue(usable[0].value)}
            x2={width - PLOT_PADDING}
            y2={yForValue(usable[0].value)}
            stroke="#2563eb"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ) : null}
        <polyline
          points={polyline}
          fill="none"
          stroke="#2563eb"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={xForIndex(usable.length - 1)}
          cy={yForValue(latest.value)}
          r={3.5}
          fill="#2563eb"
        />
      </svg>

      <div style={CAPTION_STYLE}>
        <span data-testid="apy-chart-min">Min {formatValue(min)}</span>
        {activeResult ? (
          <span data-testid="apy-chart-window">
            {activeResult.windowDays.toFixed(2)} day window
          </span>
        ) : (
          <span data-testid="apy-chart-max">Max {formatValue(max)}</span>
        )}
      </div>

      <div style={{ ...CAPTION_STYLE, fontSize: 11 }}>
        <span>{usable[0].label}</span>
        {shouldFetch ? (
          <button
            type="button"
            onClick={retry}
            disabled={loading}
            style={{
              border: 'none',
              background: 'transparent',
              color: '#2563eb',
              cursor: loading ? 'progress' : 'pointer',
              fontFamily: 'inherit',
              fontSize: 11,
              padding: 0,
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : (
          <span>{latest.label}</span>
        )}
      </div>
    </div>
  );
};
