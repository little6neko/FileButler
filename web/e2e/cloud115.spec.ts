import { expect, test } from "@playwright/test";

test("shared cloud menus open PowerRename and SuperRename with cloud-only APIs", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
  const submissions: { method: string; params: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const group = {
    path: "Album", name: "Album", images: [{ sourcePath: "Album/old.jpg", name: "old.jpg", extension: ".jpg", mediaKind: "image" }], videos: [],
    unmatched: [], childDirectories: [], directOccupiedPaths: ["Album/old.jpg"], recoveryResidues: [],
    videoDirectory: { path: "Album/视频", status: "missing", occupiedPaths: [] },
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/roots") data = [];
    else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/profile") data = { accountId: "7", name: "Cloud tester" };
    else if (path === "/api/cloud115/browse") data = { entries: [{ id: "1", parentId: "0", name: "old.jpg", isDirectory: false, size: 42 }], offset: 0, total: 1 };
    else if (path === "/api/cloud115/power.preview") data = { previewToken: "fixed", hasConflict: false, items: [{ sourcePath: "0/old.jpg", targetPath: "0/new.jpg", oldName: "old.jpg", newName: "new.jpg", changed: true, conflict: false }] };
    else if (path === "/api/cloud115/super.preview") data = { rootId: "@115", directoryPath: ".", generatedAtUnix: 1, revision: "groups", groups: [group] };
    else if (path.endsWith(".submit")) {
      submissions.push({ method: path.split("/").at(-1)!, params: route.request().postDataJSON() });
      data = { id: `batch-${submissions.length}` };
    } else if (path === "/api/jobs/events") {
      return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"batch","cursor":0,"reset":false,"jobs":[]}\n\n' });
    } else if (path.includes("rename")) throw new Error(`cloud routed to local API: ${path}`);
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await cloud.getByRole("button", { name: "old.jpg", exact: true }).click();
  await cloud.getByRole("button", { name: "More", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: /^Copy$/ })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /link source/i })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await cloud.getByRole("button", { name: "old.jpg", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu").last();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBeTruthy();
  await page.setViewportSize({ width: 1500, height: 240 });
  await expect.poll(() => menu.evaluate((element) => element.scrollHeight > element.clientHeight)).toBeTruthy();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.keyboard.press("Escape");
  await cloud.getByRole("button", { name: "PowerRename", exact: true }).click();
  const power = page.getByTestId("power-rename-content");
  await expect(power.getByRole("checkbox", { name: "Modify file properties" })).toBeDisabled();
  await expect(power.getByRole("checkbox", { name: "Modify file properties" })).not.toBeChecked();
  await expect(power.getByText("new.jpg", { exact: true })).toBeVisible();
  await power.getByRole("button", { name: /Rename 1/ }).click();
  await expect(power).toHaveCount(0);
  expect(submissions[0]).toEqual({ method: "power.submit", params: { parentId: "0", previewToken: "fixed" } });
  await cloud.getByRole("button", { name: "SuperRename", exact: true }).click();
  const tree = page.getByTestId("super-rename-content");
  await expect(tree.getByTestId("super-rename-item-Album/old.jpg")).toContainText("01.jpg");
  await tree.getByTestId("super-rename-group-Album").getByRole("button", { name: /Rename/ }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1]).toEqual({ method: "super.submit", params: { parentId: "0", paths: ["Album/old.jpg"], revisions: { Album: "groups" } } });
  // Submission alone must not remove the group before the terminal SSE event.
  await expect(tree.getByTestId("super-rename-group-Album")).toBeVisible();
  expect(errors).toEqual([]);
});

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
