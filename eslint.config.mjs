import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/storybook-static/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/*.cjs',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: globals.node } },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Module boundaries (ADR-001 / ADR-004): only db/ may touch the driver, so every query
    // goes through Database.withTenant/withSystem and carries tenant context.
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'pg',
              message: 'Use Database.withTenant()/withSystem() from src/db/database.ts.',
            },
          ],
          patterns: [
            {
              group: ['**/modules/*/*.service.js'],
              importNames: ['default'],
              message: 'Import services by name.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/api/**', '@wd/api'],
              message: 'The web app talks to the API over HTTP only.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/apps/**'], message: 'Packages must not depend on apps.' }] },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**', '**/e2e/**', '**/db/**'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-non-null-assertion': 'off' },
  },
);
