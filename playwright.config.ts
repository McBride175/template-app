import { defineConfig, devices } from '@playwright/test'
import { assertTestEnvironment, authenticated, authFile, baseURL, isLocal } from './tests/e2e/environment'

assertTestEnvironment()

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalTimeout: 300_000,
  globalSetup: './tests/e2e/global-setup.ts',
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL,
    headless: true,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'chromium', testIgnore: '**/authenticated*.spec.ts', use: devices['Desktop Chrome'] },
    { name: 'chromium-authenticated', testMatch: '**/authenticated*.spec.ts',
      use: { ...devices['Desktop Chrome'], storageState: authenticated ? authFile : undefined } },
  ],
  webServer: isLocal ? {
    command: `pnpm dev --webpack --hostname 127.0.0.1 --port ${new URL(baseURL).port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER !== '0' && !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_SITE_URL: baseURL, NEXT_TELEMETRY_DISABLED: '1' },
  } : undefined,
})
