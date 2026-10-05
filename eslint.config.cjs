const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    settings: {
      react: {
        version: '19.2',
      },
    },
  },
  {
    files: ['**/test/**/*.mjs'],
    rules: {
      // These tests deliberately import build output that may not exist before lint.
      'import/no-unresolved': 'off',
    },
  },
  {
    // 生产代码必须使用 infrastructure/logger.ts 的结构化日志，禁止重新引入 console.*。
    files: ['apps/api/src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
  globalIgnores([
    '**/.expo/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
  ]),
]);
