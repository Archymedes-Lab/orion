import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", ".expo/**"] },
  ...tseslint.configs.recommended,
  // The decision engine is deterministic math shared by the app, the web app and the server (tests/static.test.js
  // checks the same rules on the AST): no network, no server code, no environment, no logging.
  {
    files: ["src/decision-engine/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/server/**", "node:*"], message: "The engine is pure math; the server calls it, not the other way round." }] }],
      "no-restricted-globals": ["error", "fetch", "XMLHttpRequest", "WebSocket", "process"],
      "no-console": "error",
    },
  },
  // The creative and priority engines must give the same answer for the same beliefs, every time.
  {
    files: ["src/decision-engine/creative.ts", "src/decision-engine/prioritize.ts"],
    rules: {
      "no-restricted-syntax": ["error",
        { selector: "MemberExpression[object.name='Math'][property.name='random']", message: "No randomness in the creative engine: it is exact." },
        { selector: "MemberExpression[object.name='Date']", message: "No clock in the creative engine." },
        { selector: "NewExpression[callee.name='Date']", message: "No clock in the creative engine." },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },
);
