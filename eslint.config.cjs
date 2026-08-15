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
  globalIgnores([
    '**/.expo/**',
    '**/.turbo/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
  ]),
]);
