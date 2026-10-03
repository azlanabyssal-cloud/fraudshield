'use strict';
const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-var': 'off',
  'prefer-const': 'error',
  'no-implicit-globals': 'off',
  'no-eval': 'error',
  'no-new-func': 'off'   // scripts/sync_site.js evaluates the reviewed arithmetic formulas in data/stats.json
};

module.exports = [
  { ignores: ['node_modules/**', 'vendor/**', 'mlops/benchmarks/data/**', 'mlops/benchmarks/results/**', 'images/**', 'icons/**'] },
  js.configs.recommended,
  { rules },
  // code that runs in the visitor's browser
  { files: ['script.js', 'lib/**/*.js'], languageOptions: { sourceType: 'script', globals: { ...globals.browser, module: 'writable', require: 'readonly', __dirname: 'readonly', Chart: 'readonly', Tesseract: 'readonly', jsQR: 'readonly' } } },
  { files: ['sw.js'], languageOptions: { sourceType: 'script', globals: { ...globals.serviceworker } } },
  // everything else is Node
  { files: ['scripts/**', 'tests/**', 'mlops/**', 'data_ops/**', 'db/**', 'field/**', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } } }
];
