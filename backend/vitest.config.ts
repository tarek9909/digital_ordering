import { defineConfig } from 'vitest/config';

// Two projects: `unit` needs nothing running; `integration` needs MySQL 8.4 and Redis 7
// (docker compose up, or the URLs in TEST_DATABASE_URL / TEST_REDIS_URL).
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'apps/*/test/**/*.int.test.ts'],
          environment: 'node',
          testTimeout: 30_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
