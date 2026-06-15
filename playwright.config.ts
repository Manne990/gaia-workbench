import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 3210);
const isCi = Boolean(process.env.CI);
const reporter: ReporterDescription[] | 'list' = isCi ? [['github'], ['html', { open: 'never' }], ['list']] : 'list';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  reporter,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: 'only-on-failure',
    trace: isCi ? 'retain-on-failure' : 'on-first-retry'
  },
  webServer: {
    command: `DATABASE_PATH=:memory: PORT=${port} npm run start`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 15_000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
