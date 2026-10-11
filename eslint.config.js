'use strict';
const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

const rules = {
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-var': 'off',
  'prefer-const': 'error',
  'no-implicit-globals': 'off',
  'no-eval': 'error',
  'no-new-func': 'off'   // scripts/sync_site.js evaluates the reviewed arithmetic formulas in data/stats.json
};

const tsFiles = ['web/**/*.{ts,tsx}'];
module.exports = [
  { ignores: ['node_modules/**', 'vendor/**', 'mlops/benchmarks/data/**', 'mlops/benchmarks/results/**', 'images/**', 'icons/**', 'web/dist/**'] },
  js.configs.recommended,
  { rules },
  // code that runs in the visitor's browser
  { files: ['script.js', 'home.js', 'lib/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, module: 'writable', require: 'readonly', __dirname: 'readonly', Chart: 'readonly', Tesseract: 'readonly', jsQR: 'readonly' } } },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } } },
  // everything else is Node
  { files: ['scripts/**', 'tests/**', 'mlops/**', 'data_ops/**', 'db/**', 'field/**', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } } },
  // the TypeScript and React app: typed linting on top of the compiler's strict mode, and the rules of hooks
  ...tseslint.configs.recommended.map(c => ({ ...c, files: tsFiles })),
  {
    files: tsFiles,
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error'
    }
  },
  // the differential tests deliberately read the old untyped modules
  { files: ['web/**/*.test.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/ban-ts-comment': 'off' } }
];
