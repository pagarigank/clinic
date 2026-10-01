import { expect, test } from "@playwright/test";

test("ping smoke: shell renders and the round trip succeeds", async ({ page }) => {
  await page.goto("/ping");
  await expect(page.getByRole("heading", { name: "Platform smoke check" })).toBeVisible();
  await expect(page.getByText(/round trip OK/)).toBeVisible({ timeout: 10_000 });
});
