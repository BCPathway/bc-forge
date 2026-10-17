// SPDX-License-Identifier: MIT
import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { ThemeProvider, useTheme, type Theme } from '../src/theme/ThemeProvider';
import { designTokenStyle } from '../src/theme';

/**
 * A panel that exercises the provider: shows the resolved scheme, the stored
 * preference, and a switch for each one.
 *
 * Styles come from the design-token bridge (#1140) rather than from a
 * stylesheet, because Storybook has no PostCSS pipeline — the same
 * `designTokenStyle()` helper a consumer would use for inline theming.
 */
const ThemePanel: React.FC = () => {
  const { theme, resolvedTheme, isSystem, setTheme, toggleTheme } = useTheme();
  const tokens = designTokenStyle(resolvedTheme);
  const options: readonly Theme[] = ['light', 'dark', 'system'];

  return (
    <section
      data-testid="theme-panel"
      style={{
        ...tokens,
        background: resolvedTheme === 'dark' ? '#0b1220' : '#ffffff',
        color: resolvedTheme === 'dark' ? '#e5e7eb' : '#111827',
        border: '1px solid #d1d5db',
        borderRadius: 12,
        padding: 16,
        display: 'grid',
        gap: 12,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <div>
        <strong data-testid="resolved-theme">{resolvedTheme}</strong>
        <span data-testid="stored-theme" style={{ marginLeft: 8, opacity: 0.7 }}>
          preference: {theme}
          {isSystem ? ' (following the OS)' : ''}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            data-testid={`theme-option-${option}`}
            aria-pressed={theme === option}
            onClick={() => setTheme(option)}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: `1px solid ${theme === option ? '#2563eb' : '#d1d5db'}`,
              background: theme === option ? '#2563eb' : 'transparent',
              color: theme === option ? '#ffffff' : 'inherit',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {option}
          </button>
        ))}

        <button
          type="button"
          data-testid="theme-toggle"
          onClick={toggleTheme}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
            font: 'inherit',
          }}
        >
          Toggle
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
        The choice is persisted to <code>localStorage</code> under{' '}
        <code>bc-forge-theme</code>; the inlined{' '}
        <code>ThemeScript</code> replays it before React loads, so the page
        never paints in the wrong scheme.
      </p>
    </section>
  );
};

const meta = {
  title: 'Foundations/ThemeProvider',
  component: ThemePanel,
  parameters: {
    // #1144 — Opt in to the mocked Web3 providers. This component needs no
    // chain, and mounting one here would be the first thing to add stray
    // buttons to the canvas.
    web3: false,
  },
} satisfies Meta<typeof ThemePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Defaults to following the OS `prefers-color-scheme`. */
export const Default: Story = {
  render: () => (
    <ThemeProvider storageKey="storybook-theme">
      <ThemePanel />
    </ThemeProvider>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByTestId('theme-panel')).toBeVisible();
  },
};

/** Starts on an explicit dark scheme regardless of the OS preference. */
export const ForcedDark: Story = {
  render: () => (
    <ThemeProvider defaultTheme="dark" storageKey="storybook-theme-forced-dark">
      <ThemePanel />
    </ThemeProvider>
  ),
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByTestId('resolved-theme'),
    ).toHaveTextContent('dark');
  },
};

/** Switching to `system` hands control back to the OS. */
export const FollowSystem: Story = {
  render: () => (
    <ThemeProvider defaultTheme="system" storageKey="storybook-theme-system">
      <ThemePanel />
    </ThemeProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByTestId('theme-option-system'));
    await expect(canvas.getByTestId('theme-option-system')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};