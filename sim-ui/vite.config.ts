import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The sim Express server (src/sim/app.ts) runs on 5173 and owns /api.
// Vite dev serves the UI on 5174 and proxies /api to it.
const API_TARGET = process.env.CARECIRCLE_SIM_ORIGIN ?? 'http://localhost:5173';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: { '/api': { target: API_TARGET, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
