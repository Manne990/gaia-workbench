import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = [
  'server/src/**/*.ts',
  'server/tests/**/*.ts',
  'client/src/**/*.ts',
  'client/src/**/*.tsx',
  'e2e/**/*.ts',
  'scripts/**/*.mjs',
  'client/vite.config.ts',
  'playwright.config.ts',
  'vitest.config.ts'
];

export default tseslint.config(
  {
    ignores: ['node_modules/', 'dist/', 'data/', 'test-results/', 'playwright-report/']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: sourceFiles,
    languageOptions: {
      ecmaVersion: 'latest',
      globals: {
        ...globals.browser,
        ...globals.node
      },
      sourceType: 'module'
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-undef': 'off',
      'no-unused-vars': 'off'
    }
  },
  {
    files: ['client/src/**/*.ts', 'client/src/**/*.tsx'],
    plugins: {
      'react-hooks': reactHooks
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error'
    }
  },
  eslintConfigPrettier
);
