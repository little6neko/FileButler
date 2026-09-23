import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, progress = false) {
  const plans: Record<string, unknown>[] = [];
  const creates: Record<string, unknown>[] = [];
  const legacy: string[] = [];
  await page.setViewportSize({ width: 2000, height: 1000 });
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/roots") data = [{ id: "local", name: "Data" }];
    else if (path === "/api/browse") data = [{ name: "local.txt", relativePath: "local.txt", type: "file", size: 4, mode: "0644", modifiedUnix: 1, isSymlink: false }];
    else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/accounts") data = [{ accountId: "7", name: "Cloud user", avatar: "", usedBytes: 1, totalBytes: 2 }];
    else if (path === "/api/cloud115/profile") data = { accountId: "7", name: "Cloud user", avatar: "", usedBytes: 1, totalBytes: 2 };
    else if (path === "/api/cloud115/browse") {
      const root = route.request().postDataJSON().parentId === "0";
      const entries = root ? [{ id: "1", parentId: "0", name: "cloud.txt", isDirectory: false, size: 4 }, { id: "9", parentId: "0", name: "Folder", isDirectory: true, size: 0 }] : [];
      data = { entries, offset: 0, total: entries.length };
    } else if (path === "/api/cloud115/ops.preview") {
      const request = route.request().postDataJSON(); plans.push(request);
      data = { items: [{ sourcePath: "selected.txt", destPath: "target/selected.txt", conflict: false }], hasConflict: false, previewToken: `plan-${plans.length}` };
    } else if (path === "/api/cloud115/ops.create") {
      creates.push(route.request().postDataJSON()); data = { id: `job-${creates.length}` };
    } else if (path === "/api/jobs/events") {
      const jobs = progress ? [1, 2, 3].map((number) => ({ id: `job-${number}`, type: "copy", status: "running", actorId: 1, sourceRootId: "@115", destRootId: "local", progressDone: 0, progressTotal: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 1, eventVersion: 1, transfer: { phase: "download", file: "cloud.txt", bytesDone: 1, bytesTotal: 100, bytesPerSecond: 1, cancelable: true } })) : [];
      return route.fulfill({ contentType: "text/event-stream", body: `event: jobs.snapshot\ndata: ${JSON.stringify({ runtimeId: "shared", cursor: 0, reset: false, jobs })}\n\n` });
    }
    else if (/\/api\/cloud115\/(copy|move|delete|upload|download)$/.test(path)) legacy.push(path);
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open File Manager", exact: true }).click();
  const local = page.locator('.desktop-window[data-window-kind="file"]');
  await local.getByRole("button", { name: /Data/ }).dblclick();
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await cloud.getByRole("button", { name: /Cloud user/ }).dblclick();
  await expect(cloud.getByRole("button", { name: "cloud.txt", exact: true })).toBeVisible();
  const title = (await cloud.locator(".desktop-window-titlebar").boundingBox())!;
  await page.mouse.move(title.x + 200, title.y + 15); await page.mouse.down();
  await page.mouse.move(1800, title.y + 15, { steps: 20 }); await page.mouse.up();
  return { local, cloud, plans, creates, legacy };
}

test("shared keyboard clipboard downloads with a warning and preserves cut state when switched to copy", async ({ page }) => {
  const { local, cloud, plans, creates, legacy } = await setup(page);
  const row = cloud.locator('[data-entry-path="1"]');
  await cloud.getByRole("button", { name: "cloud.txt", exact: true }).click();
  await page.keyboard.press("Control+x");
  await expect(row).toHaveAttribute("data-clipboard-cut", "true");
  await local.getByRole("button", { name: "local.txt", exact: true }).click();
  await page.keyboard.press("Control+v");
  await expect(local.getByRole("dialog", { name: "move preview" })).toBeVisible();
  await expect(local.getByText("下载成功后将删除115上的源文件。")).toBeVisible();
  expect(plans.at(-1)).toMatchObject({ type: "move", accountId: "7", sourceRoot: "@115", sources: ["1"], destRoot: "local" });
  expect(creates).toHaveLength(0);
  await local.getByRole("radio", { name: "copy", exact: true }).click();
  await expect(local.getByText("下载成功后将删除115上的源文件。")).toHaveCount(0);
  await local.getByRole("button", { name: "Start copy" }).click();
  await expect(local.getByRole("dialog")).toHaveCount(0);
  await expect(row).toHaveAttribute("data-clipboard-cut", "true");
  await local.getByRole("button", { name: "local.txt", exact: true }).click();
  await page.keyboard.press("Control+v");
  await local.getByRole("button", { name: "Start move" }).click();
  await expect.poll(() => creates.length).toBe(2);
  await expect(row).not.toHaveAttribute("data-clipboard-cut", "true");
  expect(legacy).toEqual([]);
});

test("canceling a pending same-account folder move aborts preview and leaves browsing usable", async ({ page }) => {
  const { cloud, creates } = await setup(page);
  let browseCalls = 0;
  await page.route("**/api/cloud115/browse", async (route) => {
    browseCalls++;
    const root = route.request().postDataJSON().parentId === "0";
    const entries = root ? [
      { id: "2", parentId: "0", name: "Large album", isDirectory: true, size: 0 },
      { id: "9", parentId: "0", name: "Destination", isDirectory: true, size: 0 },
    ] : [];
    await route.fulfill({ json: { data: { entries, total: entries.length, offset: 0 } } });
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const previews: Record<string, unknown>[] = [];
  const failures: string[] = [];
  page.on("requestfailed", (request) => { if (request.url().endsWith("/ops.preview")) failures.push(request.failure()?.errorText ?? ""); });
  await page.route("**/api/cloud115/ops.preview", async (route) => {
    previews.push(route.request().postDataJSON());
    await pending;
    await route.fulfill({ json: { data: { items: [], hasConflict: false, previewToken: "late" } } });
  });
  try {
    await cloud.getByRole("button", { name: / refresh$/ }).click();
    await cloud.getByRole("button", { name: "Large album", exact: true }).click();
    await page.keyboard.press("Control+x");
    await expect(cloud.locator('[data-entry-path="2"]')).toHaveAttribute("data-clipboard-cut", "true");
    await cloud.getByRole("button", { name: "Destination", exact: true }).dblclick();
    await expect(cloud.getByRole("button", { name: "mkdir", exact: true })).toBeEnabled();
    await page.keyboard.press("Control+v");
    const dialog = cloud.getByRole("dialog", { name: "move preview" });
    await expect(dialog).toBeVisible();
    await expect.poll(() => previews.length).toBe(1);
    expect(previews[0]).toMatchObject({ type: "move", sources: ["2"], destPath: "9", sourceAccountId: "7", destAccountId: "7" });
    await expect(dialog.getByRole("button", { name: "Start move" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => failures.length).toBe(1);
    const before = browseCalls;
    await cloud.getByRole("button", { name: / refresh$/ }).click();
    await expect.poll(() => browseCalls).toBeGreaterThan(before);
    expect(creates).toHaveLength(0);
    await expect(cloud.getByRole("alert")).toHaveCount(0);
  } finally { release(); }
});

test("local cut uploads through the shared preview, cloud delete and paste never submit without confirmation", async ({ page }) => {
  const { local, cloud, plans, creates, legacy } = await setup(page);
  await local.getByRole("button", { name: "local.txt", exact: true }).click();
  await page.keyboard.press("Control+x");
  await page.locator(".taskbar-window-button").nth(1).click();
  await cloud.getByRole("button", { name: "cloud.txt", exact: true }).click();
  await page.keyboard.press("Control+v");
  await expect(cloud.getByText("上传成功后将删除本地源文件。")).toBeVisible();
  expect(plans.at(-1)).toMatchObject({ sourceRoot: "local", destRoot: "@115", destPath: "0", type: "move" });
  await cloud.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(creates).toHaveLength(0);
  await cloud.getByRole("button", { name: "cloud.txt", exact: true }).click();
  await page.keyboard.press("Control+x");
  await cloud.getByRole("button", { name: "Folder", exact: true }).dblclick();
  await expect(cloud.locator('[data-entry-path="1"]')).toHaveCount(0);
  await expect(cloud.locator(".file-list")).toHaveAttribute("aria-busy", "false");
  await page.keyboard.press("Control+v");
  await expect(cloud.getByRole("dialog", { name: "move preview" })).toBeVisible();
  expect(plans.at(-1)).toMatchObject({ sourceRoot: "@115", destRoot: "@115", sources: ["1"], destPath: "9", type: "move" });
  await expect(cloud.getByText(/成功后将删除/)).toHaveCount(0);
  await cloud.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.keyboard.press("Backspace");
  await cloud.getByRole("button", { name: "cloud.txt", exact: true }).click();
  await cloud.getByRole("button", { name: "delete", exact: true }).click();
  await expect(cloud.getByRole("dialog", { name: "delete preview" })).toBeVisible();
  expect(creates).toHaveLength(0);
  expect(plans.at(-1)).toMatchObject({ sourceRoot: "@115", sources: ["1"], type: "delete" });
  await cloud.getByRole("button", { name: "Delete 1 item", exact: true }).click();
  await expect.poll(() => creates.length).toBe(1);
  expect(legacy).toEqual([]);
});

test("cloud drag uses shared names, current-directory rejection and destination highlights", async ({ page }) => {
  const { cloud, plans, creates } = await setup(page);
  const source = (await cloud.getByRole("button", { name: "cloud.txt", exact: true }).boundingBox())!;
  const bounds = (await cloud.boundingBox())!;
  await page.mouse.move(source.x + 25, source.y + source.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 30, 470, { steps: 15 });
  const overlay = page.locator(".file-drag-overlay");
  await expect(overlay).toContainText("cloud.txt");
  await expect(overlay).toHaveAttribute("data-drop-state", "invalid");
  await expect(cloud.locator('.file-list-drop-feedback[data-drop-state="invalid"]')).toBeVisible();
  await page.mouse.move(50, 800, { steps: 15 });
  await expect(overlay.locator("small")).toHaveCount(0);
  await expect(overlay).toContainText("cloud.txt");
  const folder = (await cloud.getByRole("button", { name: "Folder", exact: true }).boundingBox())!;
  await page.mouse.move(folder.x + 30, folder.y + folder.height / 2, { steps: 20 });
  await expect(overlay).toHaveAttribute("data-drop-state", "valid");
  await expect(overlay.locator("small")).toHaveText("move to Folder");
  await expect(cloud.locator('[data-entry-path="9"]')).toHaveAttribute("data-drop-state", "valid");
  await page.mouse.up();
  await expect(cloud.getByRole("dialog", { name: "move preview" })).toBeVisible();
  expect(plans.at(-1)).toMatchObject({ type: "move", sourceRoot: "@115", destRoot: "@115", destPath: "9" });
  expect(creates).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: "7" } })));
  await expect(cloud.getByRole("dialog")).toHaveCount(0);
});

test("every transfer progress window is centered on the destination window", async ({ page }) => {
  const { cloud, local } = await setup(page, true);
  await cloud.getByRole("button", { name: "cloud.txt", exact: true }).click();
  await page.keyboard.press("Control+c");
  await local.getByRole("button", { name: "local.txt", exact: true }).click();
  for (const number of [1, 2, 3]) {
    await page.keyboard.press("Control+v");
    await local.getByRole("button", { name: "Start copy" }).click();
    const progress = page.locator(`[data-progress-job="job-${number}"]`);
    await expect(progress).toBeVisible();
    const target = (await local.boundingBox())!;
    const popup = (await progress.boundingBox())!;
    expect(Math.abs(popup.x + popup.width / 2 - target.x - target.width / 2)).toBeLessThan(2);
    expect(Math.abs(popup.y + popup.height / 2 - target.y - target.height / 2)).toBeLessThan(2);
    await progress.getByRole("button", { name: "Run in background" }).click();
  }
});
