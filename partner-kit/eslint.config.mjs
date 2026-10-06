import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

const config = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactPlugin.configs.flat.recommended,
  eslintPluginPrettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-misused-promises': 'off', // https://github.com/typescript-eslint/typescript-eslint/issues/5807
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/promise-function-async': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        // The examples and scripts are plain JavaScript, type-checked by tsconfig.examples.json.
        project: ['./tsconfig.json', './tsconfig.examples.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // The examples and scripts: plain JavaScript for Node. Their types come from the package
    // (tsconfig.examples.json checks them); the no-unsafe rules only flag JavaScript as JavaScript.
    files: ['examples/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
);

export default config;
