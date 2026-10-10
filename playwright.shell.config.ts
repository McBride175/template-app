import { defineConfig, devices } from '@playwright/test'

// Isolated component simulation: no application session, backend or credentials.
// Separate from guarded application E2E; never bypass its Test preflight.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'product-shell.layout.ts',
  workers: 1,
  retries: 1,
  timeout: 30_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/shell-results.json' }]],
  outputDir: 'test-results/shell',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:6006',
    screenshot: 'only-on-failure', trace: 'on-first-retry', serviceWorkers: 'block' },
  webServer: { command: 'pnpm storybook', url: 'http://127.0.0.1:6006/iframe.html',
    reuseExistingServer: !process.env.CI, timeout: 120_000 },
})
