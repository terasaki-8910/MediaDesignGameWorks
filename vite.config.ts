import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

function buildId(): string {
  const env = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(buildId()) },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
