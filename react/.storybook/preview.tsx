// SPDX-License-Identifier: MIT
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: { layout: 'fullscreen' },
  beforeEach: ({ canvasElement }) => {
    delete canvasElement.dataset.storyReady;
  },
  afterEach: ({ canvasElement, id }) => {
    canvasElement.dataset.storyReady = id;
  },
  decorators: [
    (Story) => (
      <main
        data-testid="story-frame"
        style={{
          padding: 24,
          width: 640,
          minHeight: 320,
          boxSizing: 'border-box',
          fontFamily: 'Arial, sans-serif',
          color: '#111827',
          background: '#ffffff',
        }}
      >
        <Story />
      </main>
    ),
  ],
};
export default preview;
