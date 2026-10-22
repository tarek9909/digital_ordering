import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import dop from './tools/eslint-rules/index.js';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', '**/*.d.ts', '.storage/**', 'infra/**', 'load/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: { dop },
    rules: {
      'dop/require-tenant-client': 'error',
      'dop/no-unscoped-raw-sql': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': ['error', { selector: "ThrowStatement > NewExpression[callee.name='Error']", message: 'Throw AppError so the HTTP layer maps it (TR-CODE-04).' }],
    },
  },
  {
    files: ['tools/**/*.{js,mjs}', 'docker/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', setInterval: 'readonly' } },
    rules: { 'no-empty': 'off' },
  },
  {
    // Infrastructure code, tests and tools may throw plain errors.
    files: ['**/test/**', 'tools/**', 'apps/worker/**', 'apps/realtime/**', 'packages/db/**', 'packages/jobs/**', '**/main.ts', 'packages/services/src/alerts.ts', 'packages/services/src/billing.ts', 'packages/auth/**', 'packages/config/**', 'packages/domain/**', 'packages/services/src/storage.ts', 'packages/services/src/aws.ts', 'packages/services/src/bootstrap.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);
