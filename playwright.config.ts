import { defineConfig, devices } from '@playwright/test';

// SW_PORT picks the dev server port (default 5173), shared with vite.config.ts. Another checkout may already be
// serving 5173 and reuseExistingServer would silently test its code, so a separate worktree runs e2e with its own
// port, e.g. `SW_PORT=5174 npx playwright test tests/e2e/bar.spec.ts` (PowerShell: `$env:SW_PORT=5174; npx playwright test ...`).
const port = Number(process.env.SW_PORT) || 5173;

export default defineConfig({
  testDir: './tests/e2e',
  // GitHub runners have no GPU, so the game renders in software and each action takes ~1s+.
  timeout: process.env.CI ? 60_000 : 30_000,
  workers: process.env.CI ? 1 : 2,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    port,
    reuseExistingServer: true,
  },
});
