import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// Browser tests against a local Supabase stack (`npx supabase start`). The app is built with the local URL + public
// anon key and served by `vite preview`, which sends the same security headers we recommend for production.
const status = process.env.SUPABASE_ANON_KEY
  ? { API_URL: process.env.SUPABASE_URL, ANON_KEY: process.env.SUPABASE_ANON_KEY }
  : JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));

export default defineConfig({
  testDir: './e2e-online',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  use: { baseURL: 'http://localhost:4174', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite build --outDir dist-online && npx vite preview --outDir dist-online --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: false, // always build with the local stack's URL/key; a stray preview would have a different CSP
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: status.API_URL, VITE_SUPABASE_ANON_KEY: status.ANON_KEY },
  },
});
