import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "node",
      environment: "node",
      include: [
        "packages/contracts/tests/**/*.test.ts",
        "packages/db/tests/**/*.test.ts",
        "apps/api/tests/**/*.test.ts",
      ],
      // tooling/boundary-fixtures/boundary.test.mjs is a standalone CI/pre-commit
      // script (spawns eslint); it does not run under vitest.
    },
  },
  {
    test: {
      name: "ui",
      environment: "jsdom",
      globals: true,
      setupFiles: ["packages/ui/tests/setup.ts"],
      include: ["packages/ui/tests/**/*.test.{ts,tsx}"],
    },
  },
  {
    test: {
      name: "web",
      environment: "jsdom",
      globals: true,
      setupFiles: ["apps/web/tests/setup.ts"],
      include: ["apps/web/tests/**/*.test.{ts,tsx}"],
    },
  },
]);
