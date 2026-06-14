import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: {
    command: 'npm run start',
    port: 3000,
    timeout: 120000,
    reuseExistingServer: !Boolean(process.env.CI),
  },
  use: {
    baseURL: 'http://127.0.0.1:3000',
  },
  reporter: [['list']],
});
