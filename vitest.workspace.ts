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
      //
      // Coverage is configured in the `test:coverage` npm script, NOT here.
      // A `coverage` block nested in a defineWorkspace project is silently
      // ignored (verified: setting lines:99 produced no threshold error, exit 0),
      // because this workspace file is deprecated in favour of `test.projects`.
      // Leaving thresholds here would be a gate that looks real and never fires.
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
