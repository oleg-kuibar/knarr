// Secure-coding rules for Knarr. See "Secure coding" in AGENTS.md for the why.
// Every rule here is an error: CI (`pnpm lint`) and the Claude Code edit hook
// both fail on violations. Loosen a rule only with a comment explaining why.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", ".vitest/**", "examples/**", "**/node_modules/**"],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // tsconfig.test.json covers all of src/, tests included.
        project: ["./tsconfig.test.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      // A stale `eslint-disable` must not silently keep a rule off.
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // ── Code execution ───────────────────────────────────────────────
      "no-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "@typescript-eslint/no-implied-eval": "error",

      // ── Child processes: only through src/utils/shell.ts ─────────────
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "node:child_process", allowTypeImports: true, message: "Use spawnShell() or spawnCommand() from src/utils/shell.ts." },
            { name: "child_process", allowTypeImports: true, message: "Use spawnShell() or spawnCommand() from src/utils/shell.ts." },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: "Never pass shell: true directly. Use spawnShell() (command line) or spawnCommand() (executable + args).",
        },
        {
          selector: "CallExpression[callee.object.name='JSON'][callee.property.name='parse']",
          message: "JSON from disk is untrusted: use parseJson/parseJsonObject/readJsonObject from src/utils/json.ts and narrow the result.",
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: "Math.random() is not for IDs or anything security-relevant. Use node:crypto (randomUUID / randomBytes).",
        },
      ],

      // ── Prototype pollution and object safety ────────────────────────
      "no-proto": "error",
      "no-extend-native": "error",
      "no-prototype-builtins": "error",

      // ── Async correctness (lost errors, races, unhandled rejections) ──
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",

      // ── Untrusted data: no `any` escaping the type system ─────────────
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",

      // ── Clarity rules that prevent real bugs ─────────────────────────
      eqeqeq: ["error", "always"],
      "no-console": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        // typeof import("...") stays allowed for vi.mock(importOriginal) typing.
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  // The only modules allowed to spawn processes / parse raw JSON.
  {
    files: ["src/utils/shell.ts", "src/utils/json.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },

  // Modules whose job is writing to the terminal or stdout.
  {
    files: [
      "src/utils/console.ts",
      "src/utils/output.ts",
      "src/utils/dry-run.ts",
      "src/utils/banner.ts",
      "src/vite-plugin.ts",
    ],
    rules: { "no-console": "off" },
  },

  // Tests and repo scripts drive real processes and inspect loose JSON.
  {
    files: ["src/**/__tests__/**", "src/**/*.test.ts", "src/**/*.bench.ts", "scripts/**", ".claude/hooks/**", "*.config.{js,ts}"],
    rules: {
      "no-console": "off",
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "no-useless-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },

  // Files outside the TS project (plain JS, root *.config.ts): no type information.
  {
    files: ["**/*.{js,mjs,cjs}", "*.config.ts"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      parserOptions: { project: false, projectService: false },
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },

  // TypeScript checks undefined names itself (and knows Node's globals).
  {
    files: ["**/*.ts"],
    rules: { "no-undef": "off" },
  },
);
