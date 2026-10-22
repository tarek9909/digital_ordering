// Run from frontend/: npx vitest run --config ../docs/audits/2026-10-22-completeness/admin-console-site.config.mts
import { defineConfig } from '../../../frontend/node_modules/vitest/dist/config.js';
import { fileURLToPath } from 'node:url';
const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url));
const audit = fileURLToPath(new URL('./', import.meta.url));
export default defineConfig({
  root: audit,
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    vitest: frontend + '/node_modules/vitest/dist/index.js',
    '@testing-library/react': frontend + '/node_modules/@testing-library/react/dist/index.js',
    '@tanstack/react-query': frontend + '/node_modules/@tanstack/react-query/build/modern/index.js',
    '@dop/client-sdk': frontend + '/packages/client-sdk/src/index.ts',
    '@dop/contracts': frontend + '/packages/contracts/src/index.ts',
    '@dop/ui': frontend + '/packages/ui/src/index.ts',
    '@dop/i18n': frontend + '/packages/i18n/src/index.ts',
    'react-router': frontend + '/node_modules/react-router/dist/development/index.mjs',
    react: frontend + '/node_modules/react',
    'react-dom': frontend + '/node_modules/react-dom',
  }, dedupe: ['react', 'react-dom'] },
  test: { environment: 'jsdom', include: ['admin-console-site-characterization.test.tsx'], fileParallelism: false },
});
