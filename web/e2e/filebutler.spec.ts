import { expect, test } from "@playwright/test";

test("initializes admin, logs in, and sees two file panes", async ({ page }) => {
  await page.goto("/");
  if (await page.getByRole("heading", { name: "Initialize administrator" }).isVisible().catch(() => false)) {
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("long-password");
    await page.getByLabel("Confirm password").fill("long-password");
    await page.getByRole("button", { name: "Create administrator" }).click();
  }
  if (await page.getByRole("heading", { name: "Administrator login" }).isVisible().catch(() => false)) {
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("long-password");
    await page.getByRole("button", { name: "Log in" }).click();
  }
  await expect(page.getByRole("region", { name: "Left pane" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Right pane" })).toBeVisible();
});
