// SPDX-License-Identifier: MIT
import React from 'react';
import type { Preview } from '@storybook/react-vite';
import { cssVariablesFor } from '../src/theme';
import { WalletFixture, type WalletFixtureVariant } from '../stories/fixtures';

/**
 * The decorator signature, derived from {@link Preview} itself rather than
 * imported from a separate entry point, so this file stays in step with
 * whatever version of `@storybook/react-vite` is pinned.
 */
type Decorator = NonNullable<Preview['decorators']>[number];

/**
 * The frame's inline style in light mode.
 *
 * These are the *original* declarations, unchanged since before #1144: the
 * Playwright visual suite (`react/visual/stories.spec.ts`) compares
 * `getByTestId('story-frame')` against zero-tolerance PNG baselines, so the
 * light-mode rendering must stay byte-identical.
 */
const LIGHT_FRAME: React.CSSProperties = {
  padding: 24,
  width: 640,
  minHeight: 320,
  boxSizing: 'border-box',
  fontFamily: 'Arial, sans-serif',
  color: '#111827',
  background: '#ffffff',
};

/**
 * The same frame in dark mode. Same geometry, tokens swapped for the dark
 * scheme's `--bc-*` values so a component that reads them matches the demo.
 */
const DARK_FRAME: React.CSSProperties = {
  padding: 24,
  width: 640,
  minHeight: 320,
  boxSizing: 'border-box',
  fontFamily: 'Arial, sans-serif',
  color: '#e5e7eb',
  background: '#0b1220',
};

/**
 * Colour-scheme decorator (#1144).
 *
 * Puts the `dark` class and every `--bc-*` design-token custom property
 * (#1140) on a wrapper *around* the story frame rather than on
 * `document.documentElement`. Two reasons, both load-bearing:
 *
 *   1. the visual suite drives the story iframe directly and asserts that
 *      nothing reaches the network and that no console error is raised, so a
 *      document-level mutation is global state that leaks between stories;
 *   2. `story-frame` is the element the screenshots are taken of, so every
 *      visual must live on or above it and nowhere else.
 *
 * The wrapper always carries *some* `dark`-vs-light marker — `data-theme` in
 * both schemes, plus the `dark` class only in dark mode — so a consumer's
 * `[data-theme='dark']` selectors and Tailwind's `dark:` variant both work
 * without the decorator special-casing light.
 */
const withTheme: Decorator = (Story, context) => {
  const theme: 'light' | 'dark' =
    context.globals.theme === 'dark' ? 'dark' : 'light';
  return (
    <div
      data-theme={theme}
      className={theme === 'dark' ? 'dark' : ''}
      style={{ ...cssVariablesFor(theme) }}
    >
      <main
        data-testid="story-frame"
        style={theme === 'dark' ? DARK_FRAME : LIGHT_FRAME}
      >
        <Story />
      </main>
    </div>
  );
};

/**
 * Mocked Web3 provider decorator (#1144).
 *
 * Mounts the real `BcForgeProvider` + `WalletProvider` against the
 * Storybook-only SDK stub, so a chain-aware story needs no node, no network and
 * no wallet extension.
 *
 * **Opt-in by design.** A story sets `parameters.web3` to one of
 * {@link WalletFixtureVariant}; anything else (including the default) renders
 * the story with no provider, exactly as it did before #1144.
 *
 * That default is deliberate, not an omission. A globally mounted provider
 * changes what existing stories *render*, not just where they read it from —
 * `TokenCard` starts fetching, `ProposalVotingPanel` starts enabling its
 * controls, and any `ConnectWallet` adds buttons to the canvas. Several
 * `play` functions select with `getByRole('button')` (singular), and the
 * visual suite compares screenshots with `maxDiffPixels: 0`. Opting in keeps
 * both contracts intact while still giving new stories one line of config.
 */
const withMockedWeb3: Decorator = (Story, context) => {
  const variant = context.parameters.web3 as WalletFixtureVariant | undefined;
  if (
    variant !== 'disconnected' &&
    variant !== 'connected' &&
    variant !== 'wrong-network' &&
    variant !== 'error'
  ) {
    return <Story />;
  }
  return (
    <WalletFixture variant={variant}>
      <Story />
    </WalletFixture>
  );
};

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',

    /**
     * `@storybook/addon-a11y` (#1144) — an a11y-friendly default.
     *
     * `'todo'` *reports* violations in the Storybook panel without failing the
     * run. It is the default because these stories predate the addon: turning
     * it on at `'error'` immediately would fail the whole suite on markup that
     * nobody has had a chance to review, which is a gate nobody can pass.
     *
     * Tighten it per story once it is clean:
     *
     * ```tsx
     * export const Ready: Story = { parameters: { a11y: { test: 'error' } } };
     * ```
     */
    a11y: {
      test: 'todo',
      config: {
        // The library already fails on incomplete form controls and missing
        // labels; keep those at the strictest level so the report is short.
        rules: [
          { id: 'label', enabled: true },
          { id: 'button-name', enabled: true },
          { id: 'aria-roles', enabled: true },
        ],
      },
    },

    /**
     * Controls panel defaults. The colour swatch matcher turns every
     * `…Background` / `…Color` prop into a picker, which is what makes the
     * inline-styled components practically explorable.
     */
    controls: {
      expanded: true,
      matchers: {
        color: /(background|color|border)$/i,
        date: /Date$/i,
      },
    },

    /**
     * Viewport presets (#1144).
     *
     * `mobile` and `tablet` are *narrower than* the 640 px `story-frame`, which
     * is the point: it forces the component itself to handle the width instead
     * of letting the decorator hide a problem.
     *
     * `defaultViewport` is deliberately **not** set. The addon applies the
     * selected viewport's `styles` to the story root, so pinning one would
     * resize the root for *every* story — and the visual suite screenshots
     * against zero-tolerance baselines. Leaving it unset means the presets are
     * available on the toolbar without silently restyling the default render.
     */
    viewport: {
      viewports: {
        mobile: {
          name: 'Mobile (375px)',
          styles: { width: '375px', height: '780px' },
          type: 'mobile',
        },
        tablet: {
          name: 'Tablet (768px)',
          styles: { width: '768px', height: '1024px' },
          type: 'tablet',
        },
        desktop: {
          name: 'Desktop (1280px)',
          styles: { width: '1280px', height: '900px' },
          type: 'desktop',
        },
        wide: {
          name: 'Wide (1920px)',
          styles: { width: '1920px', height: '1080px' },
          type: 'desktop',
        },
      },
    },

    /**
     * `@storybook/addon-themes` (#1144). The keys match `globalTypes.theme`
     * below and are consumed by {@link withTheme}.
     */
    themes: {
      light: { name: 'Light' },
      dark: { name: 'Dark' },
    },

    /**
     * Mocked chain/wallet state, read by {@link withMockedWeb3}. Anything other
     * than a {@link WalletFixtureVariant} renders the story bare.
     */
    web3: undefined,
  },

  /**
   * Light/dark toolbar toggle (#1144). Drives {@link withTheme} and the
   * `themes` parameter above.
   */
  globalTypes: {
    theme: {
      description: 'Global colour scheme for every story',
      defaultValue: 'light',
      toolbar: {
        title: 'Theme',
        icon: 'circlehollow',
        items: [
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },

  /**
   * The Web3 decorator wraps the theme decorator, which wraps the frame. Order
   * matters: everything the frame renders must already be inside the mocked
   * providers.
   */
  decorators: [withMockedWeb3, withTheme],

  /**
   * The Playwright visual suite (`react/visual/stories.spec.ts`) waits for
   * `#storybook-root` to carry `data-story-ready="<story id>"` before it
   * screenshots. Deleting the attribute first stops a previous story's value
   * from satisfying the assertion for the next one; writing the new value in
   * `afterEach` is the signal. **Do not remove either hook.**
   */
  beforeEach: ({ canvasElement }) => {
    delete canvasElement.dataset.storyReady;
  },
  afterEach: ({ canvasElement, id }) => {
    canvasElement.dataset.storyReady = id;
  },
};
export default preview;
