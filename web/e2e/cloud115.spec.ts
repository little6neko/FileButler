import { expect, test } from "@playwright/test";

test("opens distinct 115 windows without secure-context crypto APIs", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/jobs/events") {
      return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"test","cursor":0,"reset":false,"jobs":[]}\n\n' });
    }
    const data = path === "/api/init/status" ? { needsInitialization: false }
      : path === "/api/auth/me" ? { id: 1, username: "admin" }
      : path === "/api/cloud115/status" ? { loggedIn: false } : [];
    await route.fulfill({ json: { data } });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const icon = page.getByRole("button", { name: "打开115网盘", exact: true });
  await icon.click();
  await expect(page.getByText("登录115网盘", { exact: true })).toBeVisible();
  await icon.click();
  const windows = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await expect(windows).toHaveCount(2);
  await expect(page.getByText("登录115网盘", { exact: true })).toHaveCount(2);
  expect(errors).toEqual([]);
});

test("desktop icons are vertical and local/cloud drag creates background transfers", async ({ page }) => {
  const transfers: { method: string; params: Record<string, unknown> }[] = [];
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/roots") data = [{ id: "test", name: "Data" }];
    else if (path === "/api/browse") data = [{ name: "local.txt", relativePath: "local.txt", type: "file", size: 4, mode: "0644", modifiedUnix: 0, isSymlink: false }];
    else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/profile") data = { accountId: "1", name: "Cloud user" };
    else if (path === "/api/cloud115/browse") data = { entries: [{ id: "123", parentId: "0", name: "cloud.txt", isDirectory: false, size: 4 }], total: 1, offset: 0 };
    else if (["/api/cloud115/upload", "/api/cloud115/download"].includes(path)) {
      transfers.push({ method: path.split("/").at(-1)!, params: route.request().postDataJSON() });
      data = { id: `transfer-${transfers.length}` };
    } else if (path === "/api/jobs/events") {
      return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"smoke","cursor":0,"reset":false,"jobs":[]}\n\n' });
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  const localIcon = page.getByRole("button", { name: "Open File Manager", exact: true });
  const cloudIcon = page.getByRole("button", { name: "打开115网盘", exact: true });
  await expect(localIcon).toBeVisible();
  const first = (await localIcon.boundingBox())!;
  const second = (await cloudIcon.boundingBox())!;
  expect(second.x).toBe(first.x);
  expect(second.y).toBeGreaterThan(first.y + first.height);
  await localIcon.click();
  const local = page.locator('[data-window-kind="file"].desktop-window');
  await local.getByRole("button", { name: /Data/ }).dblclick();
  await expect(local.locator('[data-entry-path="local.txt"]')).toBeVisible();
  await cloudIcon.click();
  const cloud = page.locator('[data-window-kind="cloud115"].desktop-window');
  await expect(cloud.getByText("cloud.txt", { exact: true })).toBeVisible();
  const title = (await cloud.locator(".desktop-window-titlebar").boundingBox())!;
  await page.mouse.move(title.x + 200, title.y + 15);
  await page.mouse.down();
  await page.mouse.move(1800, title.y + 15, { steps: 20 });
  await page.mouse.up();
  const row = (await local.getByRole("button", { name: "local.txt", exact: true }).boundingBox())!;
  const cloudBounds = (await cloud.boundingBox())!;
  const targetX = cloudBounds.x + cloudBounds.width - 40;
  await page.mouse.move(row.x + 20, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, 480, { steps: 30 });
  await expect(page.locator(".file-drag-overlay")).toBeVisible();
  await page.mouse.up();
  await expect.poll(() => transfers.length).toBe(1);
  expect(transfers[0]).toEqual({ method: "upload", params: { rootId: "test", paths: ["local.txt"], destId: "0" } });
  // Focus uncovered content, not the title bar's maximize/minimize controls.
  await page.mouse.click(targetX, 430);
  const cloudRow = (await cloud.getByText("cloud.txt", { exact: true }).boundingBox())!;
  await page.mouse.move(cloudRow.x + 30, cloudRow.y + cloudRow.height / 2);
  await page.mouse.down();
  await page.mouse.move(row.x + 20, 480, { steps: 30 });
  await expect(page.locator(".file-drag-overlay")).toContainText("下载");
  await page.mouse.up();
  await expect.poll(() => transfers.length).toBe(2);
  expect(transfers[1]).toEqual({ method: "download", params: { rootId: "test", path: ".", ids: ["123"] } });
});
