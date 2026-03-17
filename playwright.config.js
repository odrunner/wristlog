import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npx serve . -l 3000 -s',
    port: 3000,
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [
    {
      name: 'mocked',
      testMatch: /.*\.mock\.spec\.js$/,
    },
    {
      name: 'integration',
      testMatch: /.*\.int\.spec\.js$/,
    },
  ],
});
