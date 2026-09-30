import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the library source directly so the demo doesn't need a build step
      '@bc-forge/react': path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
});
