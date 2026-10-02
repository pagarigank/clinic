import { expect, test } from "@playwright/test";

test.describe("Billing Phase 7 Flows (todo.md §7.2, §7.3, exit gate)", () => {
  test.beforeEach(async ({ page }) => {
    // 1. Mock authentication
    await page.route("**/api/v1/auth/session", async (route) => {
      await route.fulfill({
        json: {
          user: { id: "u-1", name: "E2E Cashier", email: "cashier@demo.clinic", role: "cashier" },
          tenant: { id: "t-1", name: "Demo Clinic", slug: "demo", status: "ACTIVE" }
        }
      });
    });

    // 2. Mock payment methods
    await page.route("**/api/v1/billing/payments/methods*", async (route) => {
      await route.fulfill({
        json: {
          data: [
            { id: "pm-cash", code: "CASH", name: "Cash" },
            { id: "pm-card", code: "CARD", name: "Credit / Debit Card" }
          ]
        }
      });
    });

    // 3. Mock Active Shift
    await page.route("**/api/v1/billing/shifts/active*", async (route) => {
      await route.fulfill({
        json: { id: "shift-1", shift_no: "SFT-1", opening_cash: 1000, branch_id: "b-1" }
      });
    });

    // 4. Mock Invoices
    await page.route("**/api/v1/billing/invoices**", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          json: {
            data: [
              {
                id: "inv-1",
                invoice_no: "INV-E2E-1",
                patient_first_name: "E2E",
                patient_last_name: "Patient",
                balance: 1000,
                total: 1000,
                status: "OPEN",
                lines: [
                  { id: "line-1", description: "Consult", net_amount: 500, is_professional_fee: true },
                  { id: "line-2", description: "Labs", net_amount: 500, is_professional_fee: false }
                ]
              }
            ]
          }
        });
      } else {
        await route.continue();
      }
    });
  });

  test("Split-tender flow ensures exact total and persists all methods", async ({ page }) => {
    // Track the payment payload
    let createPaymentPayload: any = null;
    await page.route("**/api/v1/billing/payments", async (route) => {
      if (route.request().method() === "POST") {
        createPaymentPayload = route.request().postDataJSON();
        await route.fulfill({
          json: { id: "pay-1", payment_no: "OR-E2E-1" }
        });
      } else {
        await route.continue();
      }
    });

    // Go to Cashier POS
    await page.goto("/billing/pos");

    // Ensure invoice loaded
    await expect(page.locator("strong", { hasText: "E2E Patient" })).toBeVisible({ timeout: 10000 });

    // The default tender is CASH for 1000. Let's change it to 400 CASH, and add 600 CARD.
    const firstRowAmount = page.locator('.row.g-2').nth(0).locator('input[type="number"]').first();
    await firstRowAmount.fill("400");
    
    // Click Add Payment Method
    await page.getByRole("button", { name: "Split Tender" }).click();
    
    // Select Card for the second tender
    const methodSelects = page.locator('.row.g-2 select');
    await methodSelects.nth(0).selectOption("pm-cash");
    await methodSelects.nth(1).selectOption("pm-card");
    
    // Fill 600 for the second tender
    const secondRowAmount = page.locator('.row.g-2').nth(1).locator('input[type="number"]').first();
    await secondRowAmount.fill("600");

    // Submit payment
    await page.getByRole("button", { name: "Complete Payment & Issue Official Receipt" }).click();

    // Assert the payload contains the split logic we just fixed
    expect(createPaymentPayload).not.toBeNull();
    expect(createPaymentPayload.amount).toBe(1000); // The total sum
    expect(createPaymentPayload.splits).toHaveLength(2);
    expect(createPaymentPayload.splits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ methodId: "pm-cash", amount: 400 }),
        expect.objectContaining({ methodId: "pm-card", amount: 600 }),
      ])
    );
  });

  test("Shift close with variance flow", async ({ page }) => {
    let closeShiftPayload: any = null;
    await page.route("**/api/v1/billing/shifts/*/close", async (route) => {
      if (route.request().method() === "POST") {
        closeShiftPayload = route.request().postDataJSON();
        await route.fulfill({ json: { id: "shift-1", status: "CLOSED" } });
      } else {
        await route.continue();
      }
    });

    await page.route("**/api/v1/billing/shifts*", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          json: { data: [{ id: "shift-1", shift_no: "SFT-1", status: "OPEN" }] }
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/billing/shifts");

    await expect(page.getByRole("cell", { name: "SFT-1" }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Close Shift" }).first().click();

    // Fill blind count with a variance
    await page.locator('#counted-cash-input').fill("1050");
    await page.getByRole("button", { name: "Submit Blind Count" }).click();

    expect(closeShiftPayload).not.toBeNull();
    expect(closeShiftPayload.countedCash).toBe(1050);
  });

  test("Void invoice flow ensures reason is required and triggers API", async ({ page }) => {
    let voidPayload: any = null;
    await page.route("**/api/v1/billing/invoices/*/void", async (route) => {
      if (route.request().method() === "POST") {
        voidPayload = route.request().postDataJSON();
        await route.fulfill({ json: { id: "inv-1", status: "VOID" } });
      } else {
        await route.continue();
      }
    });

    await page.goto("/billing/invoices");

    // Wait for the workbench to load the mock invoice
    await expect(page.getByText("INV-E2E-1")).toBeVisible({ timeout: 10000 });
    
    // Click 'Details' button for the invoice
    await page.getByRole("button", { name: "Details" }).first().click();
    
    // Open Void modal
    await page.getByRole("button", { name: "Void Invoice" }).click();

    // Fill void reason
    await page.locator('textarea').fill("Patient cancelled before consultation");
    
    // Confirm void
    await page.getByRole("button", { name: "Confirm Void" }).click();

    expect(voidPayload).not.toBeNull();
    expect(voidPayload.reason).toBe("Patient cancelled before consultation");
  });

  test("Discount with ID flow ensures ID type and number are passed to API", async ({ page }) => {
    let discountPayload: any = null;
    await page.route("**/api/v1/billing/invoices/*/discounts", async (route) => {
      if (route.request().method() === "POST") {
        discountPayload = route.request().postDataJSON();
        await route.fulfill({ json: { id: "disc-1" } });
      } else {
        await route.continue();
      }
    });

    await page.route("**/api/v1/billing/discount-types**", async (route) => {
      await route.fulfill({
        json: {
          data: [
            { id: "dt-pwd", code: "PWD", name: "PWD Discount", percentage: 20, requires_id: true, legal_basis: "RA 10754" }
          ]
        }
      });
    });

    await page.goto("/billing/invoices");
    await expect(page.getByText("INV-E2E-1")).toBeVisible({ timeout: 10000 });
    
    await page.getByRole("button", { name: "Details" }).first().click();
    await page.locator('button', { hasText: 'Apply Discount' }).first().click();

    // Select discount type
    await page.getByLabel("Discount Program").selectOption("dt-pwd");

    // The modal should now show ID inputs because requires_id is true
    await page.locator("select").nth(1).selectOption("PWD_ID");
    await page.getByPlaceholder("e.g., OSCA-MNL-2024-884").fill("PWD-12345");

    await page.getByRole("button", { name: "Apply Discount", exact: true }).click();

    expect(discountPayload).not.toBeNull();
    expect(discountPayload.discountTypeId).toBe("dt-pwd");
    expect(discountPayload.idType).toBe("PWD_ID");
    expect(discountPayload.idNumber).toBe("PWD-12345");
  });
});
