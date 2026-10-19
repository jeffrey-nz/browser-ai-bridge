// Lint for correctness, not style (prettier owns style). It earns its place: the first
// run found two variables used outside the block that declared them — a page claim that
// was never released in authSequence.js, and a ReferenceError in copilot's verifyAck.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "reports/**", "evidence/**"] },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      // Node, plus the browser globals that page.evaluate() callbacks run against.
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // Arguments are exempt: provider methods and Express handlers keep their full
      // signatures (an error handler is recognised by having four parameters).
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true, varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Copilot pads text with non-breaking spaces, and the extractor's regexes and their
      // comments name U+00A0 literally.
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipComments: true, skipTemplates: true }],
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  },
];
