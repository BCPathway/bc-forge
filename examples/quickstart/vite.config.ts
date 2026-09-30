import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@bc-forge/sdk': path.resolve(__dirname, '../../sdk/src/index.ts'),
      '@bc-forge/react': path.resolve(__dirname, '../../react/src/index.ts'),
    },
  },
});