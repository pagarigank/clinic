// @ts-check
import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/**
 * Boundary lint rules (todo.md Phase 0.1; frontend §4; architecture §21.2).
 * Enforced contract:
 *  - react-bootstrap / bootstrap importable only from packages/ui (ADR-8)
 *  - pg pool / withTenant importable only from packages/db
 *  - dexie reachable only from apps/web shared/offline and shell
 *  - feature deep imports blocked; features export via their index
 *  - no SECURITY DEFINER, no SELECT * in migrations (architecture §6.3, §21.2)
 * Deliberate violations live in tooling/boundary-fixtures (excluded from the
 * normal lint run) and are asserted to FAIL by a dedicated test.
 */
export default [
  js.configs.recommended,
  {
    // NOTE: tooling/boundary-fixtures is deliberately NOT ignored here — the
    // boundary test lints those files to prove the rules fire. The normal
    // `pnpm lint` script excludes them via --ignore-pattern.
    ignores: ["**/dist/**", "**/node_modules/**", "**/*.mjs", "**/*.cjs"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // TypeScript's compiler owns undefined-variable detection; no-undef
      // cannot see JSX/ambient types and false-positives on React.
      "no-undef": "off",
      // The TS rule understands parameter properties and type annotations;
      // the core rule false-positives on both.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "after-used", varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react-bootstrap", "bootstrap"],
              message: "ADR-8: Bootstrap imports are confined to packages/ui.",
            },
            {
              group: ["dexie"],
              message:
                "Dexie is reachable only from apps/web shared/offline and shell (frontend §4).",
            },
            {
              group: ["@features/*/*"],
              message:
                "No deep feature imports; import from the feature's index (frontend §4).",
            },
          ],
        },
      ],
    },
  },
  {
    // Declaration files only declare — unused params are the contract.
    files: ["**/*.d.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off", "no-unused-vars": "off" },
  },
  {
    // ADR-8 escape hatch: packages/ui is the one place Bootstrap imports live.
    // (Group negations cannot exempt importing files — only module sources —
    // so the exemption is a config override instead.)
    files: ["packages/ui/**/*.{ts,tsx}"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    // Everyone except packages/db and packages/ui may not touch the pool directly
    // (ui is exempt because it re-exports layout primitives, not db access).
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    ignores: ["packages/db/**", "packages/ui/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["pg", "**/db/pool*", "**/withTenant*"],
              message:
                "Only packages/db may import the pool or withTenant (architecture §21.2).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TemplateElement[value.raw=/_p20\\d{2}(m\\d{2})?/i]",
          message: "No ad-hoc partition access (architecture §6.4). Target the parent table.",
        },
      ],
    },
  },
  {
    // Real migrations live under packages/db; the boundary-fixture dir is
    // included too so the dedicated fixture proves these rules actually fire
    // (boundary.test.mjs asserts the violation fails and clean.ts passes).
    files: ["packages/db/migrations/**/*.ts", "tooling/boundary-fixtures/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TemplateElement[value.raw=/SECURITY[\\s\\n]+DEFINER/i]",
          message: "SECURITY DEFINER bypasses RLS (architecture §6.3) — forbidden in migrations.",
        },
        {
          selector: "TemplateElement[value.raw=/SELECT[\\s\\n]+\\*/i]",
          message: "No SELECT * in migrations (architecture §21.2).",
        },
        {
          selector: "TemplateElement[value.raw=/_p20\\d{2}(m\\d{2})?/i]",
          message: "No ad-hoc partition access (architecture §6.4). Target the parent table.",
        },
      ],
    },
  },
];
