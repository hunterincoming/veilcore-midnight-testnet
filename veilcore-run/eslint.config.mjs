// SPDX-License-Identifier: Apache-2.0
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      // Node runs these files by stripping types: a type must be imported as a type.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*', '**/partner-kit/**', '**/api/src/**', '**/contract/src/**', '**/bboard-cli/**'],
              message: "VeilCore-run uses the partner kit's public surface only: import from '@veilcore/contracts'.",
            },
          ],
        },
      ],
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Tests drive the operator code against the kit's own chain stand-in.
    files: ['test/**/*.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
);
