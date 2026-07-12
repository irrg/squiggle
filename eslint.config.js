import js from "@eslint/js";
import globals from "globals";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import importPlugin from "eslint-plugin-import";

export default [
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
        appRoot: "readonly",
      },
    },
    rules: {
      "no-console": "off",
      "prettier/prettier": "error",
      "import/no-unresolved": "off",
    },
  },
];
