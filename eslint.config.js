import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Il frontend aveva un solo gate — il compilatore TypeScript — contro i quattro
 * del lato Rust (fmt, check, clippy, test). Queste regole colmano la parte che
 * `tsc` non vede: dipendenze mancanti negli hook, promise non attese, variabili
 * inutilizzate che sopravvivono ai refactor.
 */
export default tseslint.config(
  // `coverage` contiene il report HTML generato, con dentro librerie di terze
  // parti: analizzarlo produrrebbe solo rumore.
  { ignores: ["dist", "coverage", "src-tauri/target", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Un `_` iniziale segnala che il valore è scartato di proposito: è il caso
      // dei tuple destructuring in cui serve solo una delle due metà.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // I file di configurazione girano in Node, non nel browser.
    files: ["*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
  },
);
