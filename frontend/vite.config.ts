import path from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Parent of frontend/ - same directory as Cargo.toml and `.env`. */
const repoRoot = path.resolve(__dirname, '..');
const frontendDir = __dirname;

function mergeEnvFiles(mode: string) {
  const rootEnv = loadEnv(mode, repoRoot, '');
  const frontendEnv = loadEnv(mode, frontendDir, '');
  const mergedEnv = { ...rootEnv, ...frontendEnv };

  for (const [key, value] of Object.entries(mergedEnv)) {
    process.env[key] ??= value;
  }
}

export default defineConfig(({ mode }) => {
  mergeEnvFiles(mode);

  return {
    envDir: repoRoot,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  };
});
