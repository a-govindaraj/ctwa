import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "apps-script/Code.gs"]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-unused-vars": [
        "error",
        { varsIgnorePattern: "^[A-Z]", argsIgnorePattern: "^[A-Z]" },
      ],
    },
  },
  {
    files: ["tests/**/*.js", "scripts/**/*.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["backend/**/*.js"],
    languageOptions: {
      globals: {
        SpreadsheetApp: "readonly",
        PropertiesService: "readonly",
        Utilities: "readonly",
        LockService: "readonly",
        ContentService: "readonly",
        UrlFetchApp: "readonly",
        DriveApp: "readonly",
        MailApp: "readonly",
        ScriptApp: "readonly",
        console: "readonly",
      },
    },
  },
]);
