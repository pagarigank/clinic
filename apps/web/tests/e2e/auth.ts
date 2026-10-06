import { expect, type Page } from "@playwright/test";

/**
 * Real sign-in through the login form.
 *
 * Every other e2e spec in this folder mocks `GET /auth/session` with
 * `page.route`, which proves the UI renders but proves nothing about the
 * backend. The clinical-chain journey needs the opposite: real credentials, a
 * real session row, and the server-side permission checks actually running —
 * that is the only way to catch a step that silently 403s.
 */

export const TENANT_SLUG = "demo-a";
const TENANT_PASSWORD = "DemoPassw0rd!2026";

/** Accounts that exist in the demo seed, each holding a distinct permission slice. */
export const ACCOUNTS = {
  /** tenant_admin: registration, visit, lab, supply, Rx verification, invoice. */
  admin: "admin@demo-a.test",
  /** pharmacist_dispenser: the only role holding `pharmacy.dispense.post`. */
  dispenser: "dispenser@demo-a.test",
  /** receptionist: the only role holding `billing.payment.create`. */
  cashier: "staff@demo-a.test",
} as const;

export type AccountKey = keyof typeof ACCOUNTS;

/**
 * Signs in as `who` and waits for the authenticated shell.
 *
 * Retries the whole sign-in once. Two dev-only wrinkles make a single attempt
 * unreliable, and neither is a credential problem:
 *
 *  1. The auth endpoints share an in-memory limiter keyed by client IP
 *     (apps/api/src/auth/rate-limit.ts — 20 login hits / 300 s). A serial chain
 *     that re-authenticates per test burns that budget across back-to-back
 *     runs, and a rejected attempt leaves the page parked on /login.
 *  2. After `POST /auth/login` succeeds the app navigates to /dashboard while
 *     the session state is still committing, so the route guard can bounce
 *     back to /login.
 *
 * The assertions are unchanged — the retry still has to reach /dashboard with
 * no alert on screen — so a genuine 401/403 still fails the run.
 */
export async function login(page: Page, who: AccountKey): Promise<void> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.goto("/login");

    await page.locator("#clinic-slug").fill(TENANT_SLUG);
    await page.locator("#login-email").fill(ACCOUNTS[who]);
    await page.locator("#login-password").fill(TENANT_PASSWORD);
    await page.getByRole("button", { name: "Sign In to Clinic" }).click();

    // A real session means the shell renders and the URL leaves /login. If the
    // credentials or the tenant were wrong we would still be sitting on /login
    // with a visible AlertBanner, so assert the destination rather than a timeout.
    try {
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
      await expect(page.getByRole("alert")).toHaveCount(0);
      return;
    } catch (err) {
      if (attempt === 2) {
        // Surface the API's own verdict so a real auth failure is readable
        // rather than looking like a flake.
        const banner = await page.getByRole("alert").allTextContents().catch(() => []);
        throw new Error(
          `sign-in as ${ACCOUNTS[who]} never reached /dashboard ` +
            `(last url ${page.url()}, alerts: ${JSON.stringify(banner)})`,
          { cause: err },
        );
      }
    }
  }
}

/** Signs the current user out so the next role can be signed in. */
export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign Out" }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
}