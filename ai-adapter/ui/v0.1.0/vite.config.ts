import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // DISABLE_HMR is useful for constrained local development environments.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching with HMR to reduce unnecessary local CPU use.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
