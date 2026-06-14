import { expect, test } from "@playwright/test";

test("loads TinyTracker workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "TinyTracker" })).toBeVisible();
  await expect(page.getByText("API")).toBeVisible();
  await expect(page.getByText("Online")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Todo" })).toBeVisible();
});
