// SPDX-License-Identifier: MIT
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';

import {
  MetricCard,
  MetricStatBox,
  formatMetricDelta,
  formatMetricValue,
  getMetricTrend,
  METRIC_VALUE_PLACEHOLDER,
} from './MetricCard';
import { theme } from '../theme';

describe('formatMetricValue', () => {
  it('renders a bigint without going through Number', () => {
    // 2^80 + 1: lossy as a double, exact as a string.
    const huge = (1n << 80n) + 1n;
    expect(formatMetricValue(huge)).toBe(huge.toString());
    expect(formatMetricValue(huge)).not.toBe(String(Number(huge)));
  });

  it('renders negative and zero bigints', () => {
    expect(formatMetricValue(0n)).toBe('0');
    expect(formatMetricValue(-42n)).toBe('-42');
  });

  it('renders numbers and strings verbatim', () => {
    expect(formatMetricValue(1234)).toBe('1234');
    expect(formatMetricValue(-3.5)).toBe('-3.5');
    expect(formatMetricValue('1,234')).toBe('1,234');
  });

  it('falls back to a placeholder for missing and non-finite values', () => {
    expect(formatMetricValue(null)).toBe(METRIC_VALUE_PLACEHOLDER);
    expect(formatMetricValue(undefined)).toBe(METRIC_VALUE_PLACEHOLDER);
    expect(formatMetricValue(Number.NaN)).toBe(METRIC_VALUE_PLACEHOLDER);
    expect(formatMetricValue(Number.POSITIVE_INFINITY)).toBe(METRIC_VALUE_PLACEHOLDER);
  });
});

describe('formatMetricDelta', () => {
  it('signs positive and negative values', () => {
    expect(formatMetricDelta(12.34)).toBe('+12.3%');
    expect(formatMetricDelta(-4)).toBe('-4.0%');
  });

  it('leaves zero unsigned and non-finite values as a placeholder', () => {
    expect(formatMetricDelta(0)).toBe('0.0%');
    expect(formatMetricDelta(Number.NaN)).toBe(METRIC_VALUE_PLACEHOLDER);
  });

  it('honours the requested precision', () => {
    expect(formatMetricDelta(1.23456, 2)).toBe('+1.23%');
  });
});

describe('getMetricTrend', () => {
  it('derives the trend from the sign', () => {
    expect(getMetricTrend(3)).toBe('up');
    expect(getMetricTrend(-3)).toBe('down');
  });

  it('treats zero, nullish and non-finite deltas as flat', () => {
    expect(getMetricTrend(0)).toBe('flat');
    expect(getMetricTrend(null)).toBe('flat');
    expect(getMetricTrend(undefined)).toBe('flat');
    expect(getMetricTrend(Number.NaN)).toBe('flat');
  });
});

describe('MetricCard', () => {
  it('renders the title, value and subtitle', () => {
    render(<MetricCard title="Total supply" value="12,500 BCC" subtitle="Updated 2m ago" />);

    expect(screen.getByTestId('metric-card-title')).toHaveTextContent('Total supply');
    expect(screen.getByTestId('metric-card-value')).toHaveTextContent('12,500 BCC');
    expect(screen.getByTestId('metric-card-subtitle')).toHaveTextContent('Updated 2m ago');
  });

  it('renders a placeholder when there is no value', () => {
    render(<MetricCard title="Holders" value={null} />);

    expect(screen.getByTestId('metric-card-value')).toHaveTextContent(METRIC_VALUE_PLACEHOLDER);
  });

  it('renders a bigint value losslessly', () => {
    const supply = (1n << 90n) + 7n;
    render(<MetricCard title="Supply" value={supply} />);

    expect(screen.getByTestId('metric-card-value')).toHaveTextContent(supply.toString());
  });

  it('colours a positive delta with the success tokens', () => {
    render(<MetricCard title="Volume" value={10} delta={8.5} deltaLabel="vs last week" />);

    const badge = screen.getByTestId('metric-card-delta');
    expect(badge).toHaveAttribute('data-trend', 'up');
    expect(badge).toHaveTextContent('+8.5%');
    expect(badge).toHaveStyle({
      backgroundColor: theme.successBackground,
      color: theme.successText,
    });
    expect(screen.getByTestId('metric-card-delta-label')).toHaveTextContent('vs last week');
  });

  it('colours a negative delta with the danger tokens', () => {
    render(<MetricCard title="Volume" value={10} delta={-3} />);

    const badge = screen.getByTestId('metric-card-delta');
    expect(badge).toHaveAttribute('data-trend', 'down');
    expect(badge).toHaveTextContent('-3.0%');
    expect(badge).toHaveStyle({
      backgroundColor: theme.dangerBackground,
      color: theme.dangerText,
    });
  });

  it('colours a zero delta with the neutral tokens', () => {
    render(<MetricCard title="Volume" value={10} delta={0} />);

    const badge = screen.getByTestId('metric-card-delta');
    expect(badge).toHaveAttribute('data-trend', 'flat');
    expect(badge).toHaveStyle({
      backgroundColor: theme.neutralBackground,
      color: theme.neutralText,
    });
  });

  it('omits the delta row when no delta is supplied', () => {
    render(<MetricCard title="Volume" value={10} />);

    expect(screen.queryByTestId('metric-card-delta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-card-delta-label')).not.toBeInTheDocument();
  });

  it('hides the trend arrow from assistive technology', () => {
    render(<MetricCard title="Volume" value={10} delta={1} />);

    const arrow = screen.getByTestId('metric-card-delta').firstElementChild;
    expect(arrow).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a skeleton while loading', () => {
    render(<MetricCard title="Total supply" value={500} loading />);

    const card = screen.getByTestId('metric-card');
    expect(card).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('metric-card-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('metric-card-skeleton-bar').length).toBeGreaterThan(0);
  });

  it('announces an accessible loading label while loading', () => {
    render(<MetricCard title="Total supply" value={500} loading loadingLabel="Fetching supply…" />);

    expect(screen.getByRole('status')).toHaveTextContent('Total supply: Fetching supply…');
  });

  it('keeps the numeric value out of the accessibility tree while loading', () => {
    render(<MetricCard title="Total supply" value={500} loading />);

    expect(screen.getByTestId('metric-card-value')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Total supply: Loading…');
  });

  it('replaces the skeleton with the value once loading finishes', () => {
    const { rerender } = render(<MetricCard title="Total supply" value={500} loading />);
    rerender(<MetricCard title="Total supply" value={500} />);

    const card = screen.getByTestId('metric-card');
    expect(card).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByTestId('metric-card-skeleton')).not.toBeInTheDocument();
    expect(screen.getByTestId('metric-card-value')).not.toHaveAttribute('aria-hidden');
    expect(screen.getByTestId('metric-card-value')).toHaveTextContent('500');
  });

  it('does not render the delta or subtitle while loading', () => {
    render(
      <MetricCard title="Volume" value={10} delta={5} deltaLabel="vs last week" subtitle="today" loading />,
    );

    expect(screen.queryByTestId('metric-card-delta')).not.toBeInTheDocument();
    expect(screen.queryByTestId('metric-card-subtitle')).not.toBeInTheDocument();
  });

  it('scales the typography with the size preset', () => {
    const { rerender } = render(<MetricCard title="Total supply" value={1} size="sm" />);
    expect(screen.getByTestId('metric-card-value')).toHaveStyle({ fontSize: '20px' });

    rerender(<MetricCard title="Total supply" value={1} size="lg" />);
    expect(screen.getByTestId('metric-card-value')).toHaveStyle({ fontSize: '36px' });
  });

  it('lets a consumer style override the defaults and forwards a ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <MetricCard
        ref={ref}
        title="Total supply"
        value={1}
        style={{ backgroundColor: 'rgb(4, 5, 6)' }}
        className="custom"
      />,
    );

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(screen.getByTestId('metric-card')).toHaveClass('custom');
    expect(screen.getByTestId('metric-card')).toHaveStyle({ backgroundColor: 'rgb(4, 5, 6)' });
  });
});

describe('MetricStatBox', () => {
  it('renders the label as the card title with the compact default size', () => {
    render(<MetricStatBox label="Holders" value={120} />);

    expect(screen.getByTestId('metric-card-title')).toHaveTextContent('Holders');
    expect(screen.getByTestId('metric-card-value')).toHaveStyle({ fontSize: '20px' });
  });

  it('forwards the delta, loading state and size', () => {
    render(<MetricStatBox label="Holders" value={120} delta={-2} size="lg" />);

    expect(screen.getByTestId('metric-card-delta')).toHaveAttribute('data-trend', 'down');
    expect(screen.getByTestId('metric-card-value')).toHaveStyle({ fontSize: '36px' });
  });

  it('renders a skeleton while loading', () => {
    render(<MetricStatBox label="Holders" value={120} loading />);

    expect(screen.getByTestId('metric-card')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('metric-card-skeleton')).toBeInTheDocument();
  });

  it('forwards a ref', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<MetricStatBox ref={ref} label="Holders" value={1} />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
  });
});