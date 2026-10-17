import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['**/out/**', '**/node_modules/**', 'docs/**', 'scripts/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['packages/adapters/dsh/probe/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } },
  { files: ['**/*.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'error' } }
);
