import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const appVersion = fs.readFileSync(path.join(projectRoot, 'VERSION'), 'utf8').trim();

  return {
    plugins: [react(), tailwindcss()],
    define: {
      __MEPBRIDGE_APP_VERSION__: JSON.stringify(appVersion),
    },
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
