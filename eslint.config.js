import js from "@eslint/js";
import globals from "globals";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import { flatConfigs as importFlatConfigs } from "eslint-plugin-import-x";

export default [
  js.configs.recommended,
  importFlatConfigs.recommended,
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
      "import-x/no-unresolved": "off",
    },
  },
];
