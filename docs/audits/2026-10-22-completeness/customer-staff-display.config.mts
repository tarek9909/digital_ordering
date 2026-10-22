import { defineConfig } from '../../../frontend/node_modules/vitest/dist/config.js';
import { fileURLToPath } from 'node:url';
const frontend = fileURLToPath(new URL('../../../frontend/', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    vitest: frontend + '/node_modules/vitest/dist/index.js',
    '@testing-library/react': frontend + '/node_modules/@testing-library/react/dist/index.js',
    '@tanstack/react-query': frontend + '/node_modules/@tanstack/react-query/build/modern/index.js',
    '@dop/i18n': frontend + '/packages/i18n/src/index.ts',
    '@dop/client-sdk': frontend + '/packages/client-sdk/src/index.ts',
    react: frontend + '/node_modules/react',
    'react-dom': frontend + '/node_modules/react-dom',
  }, dedupe: ['react', 'react-dom'] },
  test: { environment: 'jsdom', include: ['customer-staff-display-*.test.tsx'], fileParallelism: false },
});
