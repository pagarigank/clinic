import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8085",
    trace: "retain-on-failure",
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm run dev",
        cwd: ".",
        url: "http://localhost:8085",
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts/ },
    { name: "billing", testMatch: /billing\.spec\.ts/ },
    // Real-backend journey: needs a running API on :3085, so it is opt-in via
    // E2E_REAL=1 rather than part of the default mocked run.
    ...(process.env.E2E_REAL
      ? [{ name: "chain", testMatch: /clinical-chain\.spec\.ts/ }]
      : []),
  ],
});
