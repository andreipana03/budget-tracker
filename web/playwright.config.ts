import { defineConfig, devices } from '@playwright/test'

import { API_PORT, DEV_JWT_SECRET, E2E_DATABASE_URL, WEB_PORT, WEB_URL } from './e2e/env.ts'

/**
 * End-to-end tests (`make e2e`, needs `make db-up`). An isolated stack:
 *  - globalSetup drops, migrates and seeds `budget_tracker_e2e` in the Docker Postgres;
 *  - the Go API on :8081 (jobs and rate limits off, mail to Mailpit) and Vite on :5174,
 *    which proxies /api to it.
 *
 * Playwright starts the webServers before globalSetup, so the API is awaited on its port
 * (its pool connects lazily) and globalSetup then waits for /health to turn 200 once the
 * database exists.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    timezoneId: 'Europe/Bucharest',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'iphone-webkit',
      use: { ...devices['iPhone 15'] },
    },
  ],
  webServer: [
    {
      name: 'API',
      command: 'go run ./cmd/api',
      cwd: '../backend',
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000, // `go run` compiles first
      stdout: 'ignore',
      stderr: 'pipe',
      env: {
        APP_ENV: 'development',
        PORT: String(API_PORT),
        DATABASE_URL: E2E_DATABASE_URL,
        JWT_SECRET: DEV_JWT_SECRET,
        JOBS_ENABLED: 'false',
        RATE_LIMIT_ENABLED: 'false',
        COOKIE_SECURE: 'false',
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: 'localhost',
        SMTP_PORT: '1025',
        APP_BASE_URL: WEB_URL,
        CORS_ALLOWED_ORIGINS: WEB_URL,
        GOOGLE_CLIENT_IDS: '',
      },
    },
    {
      name: 'Web',
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'ignore', // Vite echoes the browser's console warnings here
      env: {
        VITE_API_BASE_URL: '/api',
        VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}`,
        VITE_GOOGLE_CLIENT_ID: '',
      },
    },
  ],
})
