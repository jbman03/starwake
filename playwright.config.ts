import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // GitHub runners have no GPU, so the game renders in software and each action takes ~1s+.
  timeout: process.env.CI ? 60_000 : 30_000,
  workers: process.env.CI ? 1 : 2,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure', video: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
  },
});
