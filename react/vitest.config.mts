import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.vitest.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
  },
});
