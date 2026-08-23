import { expect, test } from "@playwright/test";

const testPassword = process.env.FILEBUTLER_E2E_PASSWORD ?? "long-password";

test("initializes admin, logs in, and uses the desktop workbench", async ({ page }) => {
  await page.goto("/");
  const initHeading = page.getByRole("heading", { name: "Initialize administrator" });
  const loginHeading = page.getByRole("heading", { name: "Administrator login" });
  const systemTaskbar = page.getByRole("navigation", { name: "System taskbar" });
  await expect(initHeading.or(loginHeading).or(systemTaskbar)).toBeVisible();

  if (await initHeading.isVisible()) {
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(testPassword);
    await page.getByLabel("Confirm password").fill(testPassword);
    const createAdminResponse = page.waitForResponse((response) => response.url().endsWith("/api/init/admin"));
    await page.getByRole("button", { name: "Create administrator" }).click();
    expect((await createAdminResponse).ok()).toBe(true);
  }
  if (await loginHeading.isVisible()) {
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password", { exact: true }).fill(testPassword);
    const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/login"));
    await page.getByRole("button", { name: "Log in" }).click();
    expect((await loginResponse).ok()).toBe(true);
  }
  await expect(systemTaskbar).toBeVisible();
  const fileManagerIcon = page.getByRole("button", { name: "Open File Manager" });
  await expect(fileManagerIcon).toBeVisible();
  await fileManagerIcon.click();
  const desktopWindow = page.locator(".desktop-window");
  await expect(desktopWindow).toHaveCount(1);
  await expect(systemTaskbar.locator(".taskbar-window-button")).toHaveCount(1);
  await desktopWindow.getByRole("button", { name: "Maximize window" }).click();
  await expect(desktopWindow).toHaveAttribute("data-window-status", "maximized");
  await desktopWindow.getByRole("button", { name: "Minimize window" }).click();
  await expect(desktopWindow).toHaveCount(0);
  await systemTaskbar.locator(".taskbar-window-button").click();
  await expect(desktopWindow).toBeVisible();

  await page.getByRole("button", { name: "Switch to compact mode" }).click();
  const compactTaskbarButton = systemTaskbar.locator(".taskbar-window-button");
  await expect(compactTaskbarButton).toHaveAttribute("data-variant", "ghost");
  await expect(compactTaskbarButton).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "Left pane" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Right pane" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy to right pane" })).toBeDisabled();
  await page.getByRole("button", { name: "Jobs" }).first().click();
  await expect(page.getByRole("dialog", { name: "Jobs" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Jobs" })).not.toBeVisible();

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const leftPane = page.getByRole("region", { name: "Left pane" });
    const rightPane = page.getByRole("region", { name: "Right pane" });
    const [leftBox, rightBox] = await Promise.all([leftPane.boundingBox(), rightPane.boundingBox()]);
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    expect(leftBox!.y).toBe(rightBox!.y);
    expect(leftBox!.x + leftBox!.width).toBeLessThan(rightBox!.x);
    await expect(page.getByRole("navigation", { name: "File actions" })).toHaveJSProperty(
      "scrollWidth",
      await page.getByRole("navigation", { name: "File actions" }).evaluate((element) => element.clientWidth),
    );
  }
});
