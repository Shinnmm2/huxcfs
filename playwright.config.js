const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.js',
    env: { PORT: '4173', DATABASE_PATH: ':memory:', ALLOWED_ORIGINS: 'https://shinnmm2.github.io,http://localhost:4173' },
    url: 'http://127.0.0.1:4173/play',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
