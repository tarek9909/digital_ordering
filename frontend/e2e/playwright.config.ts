import { defineConfig, devices } from '@playwright/test';

// End-to-end journeys (TRD §26.1). Run against a local stack (README quick start) or staging:
//   E2E_DOMAIN=dop.localhost npx playwright test -c e2e
// Hosts follow production: t.{domain} customer, {slug}.{domain}/staff, /display, /admin.
export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', locale: 'en-US' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    ...(process.env.E2E_ALL_BROWSERS ? [{ name: 'webkit', use: { ...devices['iPhone 14'] } }, { name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : []),
  ],
});
