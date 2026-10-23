import { defineConfig, devices } from '../../../../frontend/node_modules/@playwright/test';

// Post-repair browser verification (REMEDIATION.md) against the isolated stack in stack.mts and Vite servers on
// 5273–5278. Reruns the audit's journey/recovery specs (they assert working flows) plus repaired-journeys.spec.ts.
// Results go to this folder only; the audit's own evidence files are not touched.
export default defineConfig({
  testDir: '..',
  testMatch: ['browser-journeys.spec.ts', 'browser-recovery.spec.ts', 'after-browser/repaired-journeys.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.E2E_RESULTS ?? 'results.json' }]],
  outputDir: 'test-output',
  use: { locale: 'en-US', trace: 'off' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: ['after-browser/repaired-journeys.spec.ts'] },
    ...(process.env.E2E_ALL_BROWSERS ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }, { name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
});
