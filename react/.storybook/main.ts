// SPDX-License-Identifier: MIT
import type { StorybookConfig } from '@storybook/react-vite';
import { fileURLToPath } from 'node:url';

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/*.stories.tsx'],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(config, {
      resolve: {
        alias: [
          {
            find: /^@bc-forge\/sdk$/,
            replacement: fileURLToPath(
              new URL('../stories/sdk.ts', import.meta.url),
            ),
          },
        ],
      },
    });
  },
};
export default config;
