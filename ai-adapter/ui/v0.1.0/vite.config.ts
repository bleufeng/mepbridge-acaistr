import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const {writeUiBuildManifest} = require('./build-manifest.cjs');

export default defineConfig(() => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const appVersion = fs.readFileSync(path.join(projectRoot, 'VERSION'), 'utf8').trim();

  const uiBuildManifest = (): Plugin => ({
    name: 'mepbridge-ui-build-manifest',
    apply: 'build',
    closeBundle() {
      writeUiBuildManifest(projectRoot);
    },
  });

  return {
    plugins: [react(), tailwindcss(), uiBuildManifest()],
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
