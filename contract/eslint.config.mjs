import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

const config = tseslint.config(
  {
    ignores: ["eslint.config.mjs", "src/managed/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  reactPlugin.configs.flat.recommended,
  eslintPluginPrettierRecommended,
  {
    ignores: ["src/managed"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off", // https://github.com/typescript-eslint/typescript-eslint/issues/5807
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/promise-function-async": "off",
      "@typescript-eslint/no-redeclare": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        // tree.mjs and descent.mjs are plain JavaScript and are not part of the
        // TypeScript program, so the project service refuses to parse them and the
        // whole lint fails. Naming them here lets them be linted without being
        // compiled.
        projectService: {
          allowDefaultProject: ["src/tree.mjs", "src/descent.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);

export default config;
