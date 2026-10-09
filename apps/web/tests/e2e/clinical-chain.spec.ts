import { expect, test, type Page } from "@playwright/test";
import { login, logout } from "./auth.js";

/**
 * Full clinical-to-cash journey, driven entirely through the UI.
 *
 * Every action here is a real form submission against the real API and the real
 * database. Nothing is stubbed with `page.route`: the point of this spec is to
 * prove the whole chain actually persists, so a green run means real rows exist
 * in `patients`, `visits`, `lab_orders`, `consumption_logs`, `prescriptions`,
 * `dispenses`, `invoices` and `payments`.
 *
 * Each step asserts persistence by reloading the screen and reading the record
 * back, rather than trusting the success toast.
 *
 * The journey needs three accounts because the demo seed splits the permissions:
 * `tenant_admin` cannot post a dispense and cannot take a payment.
 */

const RUN = Date.now().toString().slice(-6);
const PATIENT_FIRST = "Jade";
// Unique per run so repeated runs never collide on the search assertions.
const PATIENT_LAST = `E2E${RUN}`;

/** Must match an in-stock, formulary, non-controlled product or the dispense
 *  workbench silently drops the line (it allocates stock by item_id). */
const RX_DRUG = "Amoxicillin 500mg";

// The consumption leg needs an item that actually has a usable batch at a known
// location. Both are seed fixtures (verified in stock_balances), so they are
// named here rather than taken from the dropdown, where the catalogue offers
// hundreds of items with no stock and the request would legitimately fail.
const STOCKED_ITEM_CODE = "AMOX-500-108729";
const STOCKED_LOCATION_NAME = "Main Pharmacy 108729";
const SUPPLY_NOTE = "E2E chain consumption";

const ctx: {
  patientLabel: string;
  patientNo: string;
  visitUrl: string;
  rxNo: string;
  invoiceNo: string;
  currentRole: string;
} = {
  patientLabel: "",
  patientNo: "",
  visitUrl: "",
  rxNo: "",
  invoiceNo: "",
  currentRole: "",
};

/** Reloads and waits, so an assertion proves the server round-tripped the data. */
async function reload(page: Page, url: string): Promise<void> {
  await page.goto(url);
}

test.describe.serial("clinical chain: registration -> visit -> lab -> supply -> dispense -> billing -> payment", () => {
  test.setTimeout(180_000);

  // One browser context for the whole journey, mirroring how a clerk actually
  // works: a single browser that is signed in as whoever owns the next step.
  //
  // This also keeps the run inside the auth rate limiter. The credential
  // endpoints share an in-memory limiter keyed by client IP (20 login hits /
  // 300 s across ALL accounts — apps/api/src/auth/rate-limit.ts). The `page`
  // fixture gives every test a fresh context, so a per-test `login()` spent 8
  // of those 20 in a single run, and consecutive runs failed mid-journey with
  // "too many attempts - retry shortly". Sharing a context means only three
  // sign-ins per run: admin, then the pharmacist, then the cashier.
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newContext().then(async (ctxBrowser) => ctxBrowser.newPage());
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  /** Signs in only when the journey has moved to a different role. */
  async function assumeRole(who: "admin" | "dispenser" | "cashier"): Promise<void> {
    if (ctx.currentRole === who) return;
    if (ctx.currentRole) await logout(page);
    await login(page, who);
    ctx.currentRole = who;
  }

  test("1. registers a patient and the record survives a reload", async () => {
    await assumeRole("admin");
    await page.goto("/patients");

    await page.getByRole("button", { name: "Register New Patient" }).click();

    // The intake modal is a hand-rolled div with no role="dialog" and no
    // label/for wiring, so it has to be scoped by its heading text.
    const modal = page.locator(".modal", { hasText: "Patient Intake & Registration" });
    await expect(modal).toBeVisible();

    await modal.getByPlaceholder("e.g. Maria").fill(PATIENT_FIRST);
    await modal.getByPlaceholder("e.g. Santos").fill(PATIENT_LAST);
    await modal.locator('input[type="date"]').fill("1992-04-17");
    await modal.locator("select").selectOption("F");
    // Collected by the form — used later to prove it was not silently dropped.
    await modal.getByPlaceholder("0917-000-0000").fill("09171234567");
    await modal
      .getByPlaceholder("e.g. Penicillin, Aspirin, Seafood (comma separated)")
      .fill("Penicillin");

    await modal.getByRole("button", { name: "Save & Create Patient Record" }).click();

    // The success message quotes a patient number. It must be the number the
    // server assigned, not one the browser made up.
    const success = page.getByText(/registered successfully/i);
    await expect(success).toBeVisible({ timeout: 20_000 });

    const message = await success.textContent();
    const patientNo = message?.match(/\(([^)]+)\)/)?.[1] ?? "";
    ctx.patientLabel = `${PATIENT_LAST}, ${PATIENT_FIRST}`;
    ctx.patientNo = patientNo;

    // Persisted, not just in local state: re-register the list from the server.
    await reload(page, "/patients");
    await page.getByPlaceholder(/Search/i).first().fill(PATIENT_LAST);
    await expect(page.getByText(ctx.patientLabel, { exact: true })).toBeVisible({ timeout: 20_000 });

    // eslint-disable-next-line no-console
    console.log(`[chain] patient=${patientNo} label=${ctx.patientLabel}`);
  });

  test("2. opens a visit for that patient", async () => {
    await assumeRole("admin");
    await page.goto("/clinical/visits");

    await page.getByRole("button", { name: "Register Visit" }).click();

    await page.getByPlaceholder("Search by name or ID...").fill(PATIENT_LAST);
    const picker = page.locator('select[size="4"]');
    await expect(picker).toBeVisible({ timeout: 20_000 });

    // The search is debounced, so the option list is empty on first paint.
    // Assert with a retrying locator instead of reading it once.
    const match = picker.locator("option", { hasText: PATIENT_LAST });
    await expect(match).toHaveCount(1, { timeout: 20_000 });
    await picker.selectOption({ label: (await match.textContent())!.trim() });

    await page
      .getByPlaceholder("Brief description of the visit purpose...")
      .fill("E2E chain: fever and cough for three days");
    await page.getByRole("button", { name: "Create Visit & Open Chart" }).click();

    await expect(page).toHaveURL(/\/clinical\/visits\/[0-9a-f-]{36}/i, { timeout: 30_000 });
    ctx.visitUrl = new URL(page.url()).pathname;
  });

  test("3. orders a lab test and logs a central-supply consumption on the chart", async () => {
    await assumeRole("admin");
    await page.goto(ctx.visitUrl);

    const labSelect = page.locator("#lab-test-select");
    await expect(labSelect).toBeVisible({ timeout: 20_000 });
    const labOptions = await labSelect.locator("option").allTextContents();
    const labValue = labOptions.find((o) => !o.startsWith("--"));
    expect(labValue).toBeTruthy();
    await labSelect.selectOption({ label: labValue! });

    await page.locator("#lab-priority").selectOption("ROUTINE");
    await page.locator("#lab-notes").fill("E2E chain screening");
    await page.getByRole("button", { name: "Order Lab Test" }).click();

    await expect(page.getByText(/ordered/i).first()).toBeVisible({ timeout: 20_000 });

    const itemSelect = page.locator("#supply-item-select");
    await expect(itemSelect).toBeVisible({ timeout: 20_000 });
    const itemOptions = await itemSelect.locator("option").allTextContents();
    // Must be an item the seed actually stocks at STOCKED_ITEM_CODE's location.
    // The catalogue lists every item, and one with no usable batch allocates
    // nothing -- the server now rejects that with CONFLICT instead of reporting a
    // consumption it never wrote.
    const itemValue = itemOptions.find((o) => o.includes(STOCKED_ITEM_CODE));
    expect(itemValue, `supply options: ${itemOptions.slice(0, 8).join(" | ")}`).toBeTruthy();
    await itemSelect.selectOption({ label: itemValue! });

    const locSelect = page.locator("#supply-loc-select");
    await expect(locSelect).toBeVisible({ timeout: 20_000 });
    const locOptions = await locSelect.locator("option").allTextContents();
    const locValue = locOptions.find((o) => o.includes(STOCKED_LOCATION_NAME));
    expect(locValue, `location options: ${locOptions.slice(0, 8).join(" | ")}`).toBeTruthy();
    await locSelect.selectOption({ label: locValue! });

    await page.locator("#supply-qty").fill("1");
    await page.locator("#supply-notes").fill(SUPPLY_NOTE);

    const [consResp] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && /\/api\/v1\/supply\/consumption\b/.test(r.url()),
          { timeout: 30_000 },
        )
        .catch(() => null),
      page.getByRole("button", { name: "Log Supply Consumption" }).click(),
    ]);
    if (!consResp) {
      throw new Error(
        `Log Supply Consumption sent no POST /supply/consumption. ` +
          `alerts: ${JSON.stringify(await page.getByRole("alert").allTextContents().catch(() => []))}`,
      );
    }
    expect(
      consResp.status(),
      `POST /supply/consumption -> ${consResp.status()} ${await consResp.text()}`,
    ).toBeLessThan(300);

    // Reload: both the lab order and the consumption must come back from the DB.
    // Asserting the note (server-side text) is what proves the row was persisted
    // -- the previous version only checked that a select was still on screen, so
    // the consumption leg passed while writing nothing.
    await reload(page, ctx.visitUrl);
    await expect(page.locator("#lab-test-select")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(SUPPLY_NOTE).first()).toBeVisible({ timeout: 20_000 });
  });

  test("4. issues a prescription that is linked to formulary stock", async () => {
    await assumeRole("admin");
    await page.goto(ctx.visitUrl);

    await page.locator("#rx-gen").fill(RX_DRUG);
    await page.locator("#rx-dose").fill("500 mg");
    await page.locator("#rx-freq").fill("3x daily");
    await page.locator("#rx-qty").fill("10");
    await page.getByRole("button", { name: "Create & issue" }).click();

    // The chart has no toast for this — the confirmation is the encounter
    // timeline entry ("Rx RX-2026-000237 issued").
    const issued = page.getByText(/Rx\s+RX-\d{4}-\d+\s+issued/i).first();
    await expect(issued).toBeVisible({ timeout: 20_000 });
    ctx.rxNo = (await issued.textContent())!.match(/RX-\d{4}-\d+/)![0];

    // Persisted, not just optimistic UI: reload and read the timeline again.
    await reload(page, ctx.visitUrl);
    await expect(page.getByText(new RegExp(`Rx\\s+${ctx.rxNo}\\s+issued`, "i"))).toBeVisible({
      timeout: 20_000,
    });

    // eslint-disable-next-line no-console
    console.log(`[chain] rx=${ctx.rxNo}`);
  });

  test("5. verifies the prescription in the pharmacy queue", async () => {
    await assumeRole("admin");
    await page.goto("/pharmacy/queue");

    // Level 1 groups one row per patient; the group row carries the Rx numbers.
    const patientRow = page.locator("tr", { hasText: ctx.rxNo });
    await expect(patientRow).toBeVisible({ timeout: 30_000 });
    await patientRow.click();

    // Level 2: the prescription row with its own verify action.
    const row = page.locator("tr", { hasText: ctx.rxNo });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: /Verify Rx/i }).click();

    await page.getByRole("button", { name: /Approve & Clear for Dispensing/i }).click();
    await expect(page.getByText(/approved|cleared for dispensing/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test("6. posts the dispense as the pharmacist", async () => {
    await assumeRole("dispenser");
    await page.goto("/pharmacy/dispenses");

    // Level 1 groups one row per patient; this run's patient has a unique surname.
    const patientRow = page.locator("tr", { hasText: PATIENT_LAST });
    await expect(patientRow).toBeVisible({ timeout: 30_000 });
    await patientRow.getByRole("button", { name: /Select Patient & Dispense/i }).click();

    // Level 2: the prescription row for this run.
    const row = page.locator("tr", { hasText: ctx.rxNo });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: /Dispense Rx/i }).click();

    await expect(page).toHaveURL(/\/pharmacy\/dispenses\/[0-9a-f-]{36}/i, { timeout: 30_000 });

    const fefo = page.getByRole("button", { name: /Allocate FEFO/i });
    if (await fefo.isEnabled()) await fefo.click();

    const post = page.getByRole("button", { name: /Post Dispense/i });
    // A disabled Post button has two very different causes: the app still
    // believes it is signed in as somebody without the dispense permission, or
    // the allocation produced no postable line. Report both instead of a bare
    // toBeEnabled timeout, which cannot tell them apart.
    if (!(await post.isEnabled())) {
      const who = (await page.locator("header").first().innerText().catch(() => "")).replace(/\s+/g, " ");
      const alerts = await page.getByRole("alert").allTextContents().catch(() => []);
      const lines = await page.locator("tbody tr").allInnerTexts().catch(() => []);
      throw new Error(
        `Post Dispense stayed disabled. header="${who}" alerts=${JSON.stringify(alerts)} ` +
          `rows=${JSON.stringify(lines.slice(0, 5))}`,
      );
    }
    await post.click();

    await expect(page.getByText(/POSTED/i).first()).toBeVisible({ timeout: 30_000 });
  });

  test("7. raises an invoice for the visit", async () => {
    await assumeRole("admin");
    await page.goto("/billing/invoices");

    await page.getByRole("button", { name: /New Invoice/i }).click();
    const modal = page.locator(".modal", { hasText: "Create New Invoice" });
    await expect(modal).toBeVisible();

    // Link the invoice to the patient and the visit being charged. The modal
    // previously sent neither, so the invoice and its payment were anonymous.
    await modal.getByLabel("Search patient").fill(ctx.patientNo);
    const match = modal.locator(".list-group-item").first();
    await expect(match).toBeVisible({ timeout: 15_000 });
    await match.click();

    const visitSelect = modal.getByLabel("Select visit");
    await expect(visitSelect).toBeVisible({ timeout: 15_000 });
    const visitValue = await visitSelect
      .locator("option:not([value=''])")
      .first()
      .getAttribute("value");
    expect(visitValue, "expected at least one visit for the patient").toBeTruthy();
    await visitSelect.selectOption(visitValue!);

    await modal.getByRole("button", { name: /Create Invoice/i }).click();
    await expect(page.getByText(/invoice successfully created/i).first()).toBeVisible({
      timeout: 20_000,
    });

    await reload(page, "/billing/invoices");
    const newest = page.locator("tbody tr", { hasText: /INV-/ }).first();
    await expect(newest).toBeVisible({ timeout: 20_000 });
    // The number is a span in the first cell, with the issue date in a sibling
    // div. Read the span so neither a pattern guess nor the concatenated cell
    // text can invent a document number.
    const numSpan = newest.locator("td").first().locator("span").first();
    await expect(numSpan).toBeVisible({ timeout: 10_000 });
    ctx.invoiceNo = ((await numSpan.textContent()) ?? "").trim();
    expect(ctx.invoiceNo).toMatch(/^INV-\d{4}-\d+$/);
  });

  test("8. takes payment as the cashier and issues the official receipt", async () => {
    await assumeRole("cashier");
    await page.goto("/billing/invoices");

    const row = page.locator("tr", { hasText: ctx.invoiceNo });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("link", { name: "Pay" }).click();

    await expect(page).toHaveURL(/\/billing\/pos/, { timeout: 30_000 });

    const openInvoices = page.getByLabel("Select invoice for settlement");
    await expect(openInvoices).toBeVisible({ timeout: 20_000 });
    const opts = await openInvoices.locator("option").allTextContents();
    const target = opts.find((o) => o.includes(ctx.invoiceNo));
    expect(target, `open invoices: ${opts.join(" | ")}`).toBeTruthy();
    await openInvoices.selectOption({ label: target! });

    // Tender the full outstanding balance in cash.
    await page.locator('input[type="number"]').first().fill("500");
    const handed = page.getByPlaceholder("Cash handed by patient");
    if (await handed.isVisible()) await handed.fill("1000");

    await page.getByRole("button", { name: /Complete Payment & Issue Official Receipt/i }).click();
    // Assert on the POST itself. "Official Receipt" is a static heading on the
    // POS page, so matching it proved nothing — the previous version passed
    // this line while no payment row was ever written.
    const payResp = await page
      .waitForResponse(
        (r) => r.request().method() === "POST" && /\/api\/v1\/billing\/payments\b/.test(r.url()),
        { timeout: 30_000 },
      )
      .catch(() => null);

    const banners = await page.getByRole("alert").allTextContents().catch(() => []);
    // expect() rejects `undefined` in the matcher itself, so a missing request
    // must be raised directly or the diagnostic message is swallowed.
    if (!payResp) {
      throw new Error(
        `Complete Payment sent no POST /billing/payments. ` +
          `alerts: ${JSON.stringify(banners)} url: ${page.url()}`,
      );
    }
    expect(
      payResp.status(),
      `POST /billing/payments -> ${payResp.status()}; alerts: ${JSON.stringify(banners)}`,
    ).toBeLessThan(300);

    // A 1,000 hand-over against a 500 invoice owes 500 change. This was silently
    // 0 because the client told the server the tendered figure was the payment
    // amount; assert it so the money cannot regress quietly.
    const payBody: any = await payResp.json();
    expect(
      Number(payBody?.payment?.changeAmount ?? payBody?.changeAmount),
      `expected change 500, got ${JSON.stringify(payBody?.payment ?? payBody)}`,
    ).toBeGreaterThan(0);

    // Persisted: the invoice must now read PAID after a reload.
    await reload(page, "/billing/invoices");
    await expect(page.locator("tr", { hasText: ctx.invoiceNo })).toContainText("PAID", {
      timeout: 30_000,
    });
  });
});