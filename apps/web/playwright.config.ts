import { defineConfig, devices } from '@playwright/test'

/**
 * Click-through journeys against the real API (PGlite with generated sample data) and the Vite
 * dev server. Run with `pnpm --filter @wm/web e2e`. CI runs them in the `e2e` job.
 * PW_CHROMIUM_PATH points at a different Chromium when Playwright's own is not installed.
 */
const executablePath = process.env.PW_CHROMIUM_PATH
const chromiumArgs = process.env.PW_CHROMIUM_ARGS?.split(' ').filter(Boolean)

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173/',
    viewport: { width: 1440, height: 950 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 950 },
        launchOptions: executablePath ? { executablePath, args: chromiumArgs ?? [] } : {},
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @wm/api exec tsx src/server.ts',
      url: 'http://127.0.0.1:3000/health',
      // Only override WM_DATA_DIR when asked: an empty value makes the API's mkdirSync('') fail.
      env: {
        PORT: '3000',
        ...(process.env.WM_E2E_DATA_DIR ? { WM_DATA_DIR: process.env.WM_E2E_DATA_DIR } : {}),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // Bind to 127.0.0.1 explicitly: Vite's default "localhost" can resolve to ::1 only (Node 17+),
      // and then the 127.0.0.1 readiness check below never succeeds.
      command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
      url: 'http://127.0.0.1:5173/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
