import { expect, test, type Page } from "@playwright/test";

async function installCloud(page: Page, initiallyLoggedIn = true) {
  let loggedIn = initiallyLoggedIn;
  let checks = 0;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const contentRequests: string[] = [];
  const entries = ["photo.jpg", "photo2.jpg", "clip.mp4", "notes.txt", "blocked.txt", "archive.zip", "unsupported.avi", "large.txt"].map((name, index) => ({ id: String(index + 1), parentId: "0", name, size: index >= 6 ? 20 * 1024 * 1024 : 42, isDirectory: false }));
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
  await page.route("https://115-preview.example/**", async (route) => {
    const url = route.request().url(); contentRequests.push(url);
    if (url.endsWith("blocked.txt")) return route.abort("accessdenied");
    if (url.endsWith(".jpg")) return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6h8AAAAASUVORK5CYII=", "base64") });
    if (url.endsWith(".mp4")) return route.fulfill({ contentType: "video/mp4", body: "unsupported video fixture" });
    return route.fulfill({ contentType: "text/plain", headers: { "Access-Control-Allow-Origin": "*" }, body: "cloud read-only text\nsecond line" });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"cloud","cursor":0,"reset":false,"jobs":[]}\n\n' });
    else if (path.startsWith("/api/cloud115/")) {
      const method = path.split("/").at(-1)!;
      const params = route.request().postDataJSON(); calls.push({ method, params });
      if (method === "accounts") data = loggedIn ? [{ accountId: "7", name: "Cloud tester", avatar: "", usedBytes: 1, totalBytes: 2 }] : [];
      else if (method === "status") data = { loggedIn };
      else if (method === "login.start") data = { image: "data:image/svg+xml;base64,PHN2Zy8+", loginSession: "test-opaque-session-123456" };
      else if (method === "login.check") { checks++; loggedIn = checks >= 2; data = { status: loggedIn ? 2 : 1, loggedIn, accountId: "7" }; }
      else if (method === "profile") data = { accountId: "7", name: "Cloud tester", avatar: "", usedBytes: 1, totalBytes: 2 };
      else if (method === "browse") data = { entries, total: entries.length, offset: 0 };
      else if (method === "preview.url") {
        const entry = entries.find((item) => item.id === params.id)!;
        data = { url: `https://115-preview.example/${entry.name}`, accountId: "7", size: entry.size };
      }
      else if (method === "preview.text") {
        const entry = entries.find((item) => item.id === params.id)!;
        if (entry.name === "blocked.txt") return route.fulfill({ status: 502, json: { error: { code: "cloud115_error", message: "GET https://115-preview.example/blocked.txt\nHTTP 403 Forbidden" } } });
        if (entry.name === "large.txt") return route.fulfill({ status: 413, json: { error: { code: "cloud115_error", message: "文本超过10 MiB预览上限，请直接下载。" } } });
        data = { accountId: "7", document: { content: "cloud read-only text\nsecond line", byteSize: 32, encoding: "utf-8", lineEnding: "lf", preferredLineEnding: "lf", revision: "cloud-read-only" } };
      }
      else if (method === "extract") data = { id: "extract-job" };
    }
    return route.fulfill({ json: { data } });
  });
  return { calls, contentRequests };
}

test("legacy cloud names warn across the row without changing ID-based navigation", async ({ page }) => {
  await installCloud(page);
  const parents: string[] = [];
  await page.route("**/api/cloud115/browse", async route => {
    const parent = route.request().postDataJSON().parentId;
    parents.push(parent);
    const entries = parent === "0" ? [
      { id: "1", parentId: "0", name: 'old?.txt', size: 42, isDirectory: false },
      { id: "2", parentId: "0", name: "A/B", size: 0, isDirectory: true },
    ] : [{ id: "3", parentId: "2", name: "normal.txt", size: 42, isDirectory: false }];
    await route.fulfill({ json: { data: { entries, total: entries.length, offset: 0 } } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  await page.getByRole("button", { name: /Cloud tester/ }).dblclick();
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  for (const id of ["1", "2"]) {
    const row = cloud.locator(`[data-entry-path="${id}"]`);
    await row.hover();
    await expect(row).toHaveAttribute("title", '文件名包含违规字符：“\\ / : * ? " < > |”');
    await expect(row.locator(".file-entry-name")).toHaveCSS("color", "rgb(161, 98, 7)");
    for (const cell of await row.locator("td").all()) await expect(cell).toHaveCSS("color", "rgb(161, 98, 7)");
  }
  await cloud.getByRole("button", { name: "A/B", exact: true }).click();
  await expect(cloud.locator('[data-entry-path="2"] .file-entry-name')).toHaveCSS("color", "rgb(161, 98, 7)");
  await cloud.getByRole("button", { name: "A/B", exact: true }).dblclick();
  const normal = cloud.locator('[data-entry-path="3"]');
  await expect(normal).toBeVisible();
  await expect(normal).not.toHaveAttribute("title");
  await expect(normal).not.toHaveAttribute("data-name-warning");
  expect(parents.at(-1)).toBe("2");
});

test("QR login enters the cloud automatically after phone confirmation", async ({ page }) => {
  const { calls } = await installCloud(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  await page.getByRole("button", { name: "添加新账号", exact: true }).click();
  await expect(page.getByText("已扫码，等待在115客户端确认")).toBeVisible();
  await expect(page.getByRole("button", { name: "我已扫码，检查登录" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Cloud tester/ }).dblclick();
  await expect(page.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();
  const checks = calls.filter((call) => call.method === "login.check");
  expect(checks).toHaveLength(2);
  expect(checks[0].params).toEqual({ loginSession: "test-opaque-session-123456" });
});

test("cloud preview loading text stays left while link buttons stay right before and after load", async ({ page }) => {
  await installCloud(page);
  let release!: () => void;
  const loading = new Promise<void>((resolve) => { release = resolve; });
  await page.route("https://115-preview.example/photo.jpg", async (route) => { await loading; await route.fallback(); });
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
    const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
    await cloud.getByRole("button", { name: /Cloud tester/ }).dblclick();
    await cloud.getByRole("button", { name: "photo.jpg", exact: true }).dblclick();
    const toolbar = page.getByRole("toolbar", { name: "直链操作" });
    const status = toolbar.getByRole("status");
    await expect(status).toHaveText("正在直接从115加载…");
    const frame = (await toolbar.boundingBox())!;
    const message = (await status.boundingBox())!;
    const copy = toolbar.getByRole("button", { name: "复制直链" });
    const before = (await copy.boundingBox())!;
    expect(message.x - frame.x).toBeLessThan(16);
    expect(message.x + message.width).toBeLessThan(before.x);
    expect(frame.x + frame.width - before.x - before.width).toBeLessThan(16);
    release();
    await expect(status).toHaveCount(0);
    expect((await copy.boundingBox())!.x).toBe(before.x);
  } finally { release(); }
});

test("cloud previews load bytes directly, text is read-only and archive double click prompts extraction", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { calls, contentRequests } = await installCloud(page);
  await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => sessionStorage.setItem("test-copied-link", text) } }));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await cloud.getByRole("button", { name: /Cloud tester/ }).dblclick();
  await expect(cloud.getByRole("button", { name: "notes.txt", exact: true })).toBeVisible();
  expect(await cloud.locator(".file-pane").evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
  await expect(page.locator('.taskbar-window-button[data-window-kind="cloud115"] .lucide-cloud')).toBeVisible();
  await expect(cloud.getByRole("button", { name: "delete", exact: true })).toHaveAttribute("data-variant", "outline");

  await cloud.getByRole("button", { name: "unsupported.avi", exact: true }).dblclick();
  await expect(page.locator('[data-window-kind="cloudPreview"]')).toHaveCount(0);
  expect(calls.some((call) => call.method === "preview.url")).toBe(false);

  await cloud.getByRole("button", { name: "photo.jpg", exact: true }).dblclick();
  let preview = page.locator('.desktop-window[data-window-kind="cloudPreview"]');
  await expect(preview.getByRole("img", { name: "photo.jpg" })).toHaveAttribute("src", "https://115-preview.example/photo.jpg");
  await expect.poll(() => contentRequests.includes("https://115-preview.example/photo.jpg")).toBe(true);
  const toolbar = preview.getByRole("toolbar", { name: "直链操作" });
  await expect(toolbar.getByRole("button")).toHaveCount(2);
  await expect(toolbar).not.toContainText("photo.jpg");
  await expect(toolbar.getByRole("link")).toHaveCount(0);
  await toolbar.getByRole("button", { name: "复制直链" }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("test-copied-link"))).toBe("https://115-preview.example/photo.jpg");
  await preview.getByRole("button", { name: /Next/ }).click();
  await expect(preview.getByRole("img", { name: "photo2.jpg" })).toBeVisible();
  await preview.getByRole("button", { name: "Close window" }).click();

  await cloud.getByRole("button", { name: "notes.txt", exact: true }).dblclick();
  preview = page.locator('.desktop-window[data-window-kind="cloudPreview"]');
  await expect(preview.locator(".cm-content")).toContainText("cloud read-only text");
  await expect(preview.locator(".cm-content")).toHaveAttribute("contenteditable", "false");
  await expect(preview.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(preview.getByRole("toolbar", { name: "直链操作" })).toHaveCount(0);
  expect(contentRequests.some(url => url.endsWith(".txt"))).toBe(false);
  expect(calls.some(call => call.method === "preview.text" && call.params.id === "4")).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: "7" } })));
  await expect(preview.getByRole("alert")).toContainText("115账号已变化");
  await expect(preview.locator(".cm-content")).toHaveCount(0);
  await expect(preview.getByRole("button", { name: "复制直链" })).toHaveCount(0);
  await preview.getByRole("button", { name: "Close window" }).click();

  await cloud.getByRole("button", { name: /Cloud tester/ }).dblclick();
  await cloud.getByRole("button", { name: "blocked.txt", exact: true }).dblclick();
  preview = page.locator('.desktop-window[data-window-kind="cloudPreview"]');
  await expect(preview.getByRole("alert")).toBeVisible();
  await expect(preview.getByRole("alert")).not.toContainText("不会通过FB中转");
  await expect(preview.getByRole("alert")).toContainText("HTTP 403 Forbidden");
  await expect(preview.getByRole("button", { name: "复制直链" })).toHaveCount(0);
  await preview.getByRole("button", { name: "Close window" }).click();

  await cloud.getByRole("button", { name: "large.txt", exact: true }).dblclick();
  preview = page.locator('.desktop-window[data-window-kind="cloudPreview"]');
  await expect(preview.getByRole("alert")).toHaveText("文本超过10 MiB预览上限，请直接下载。");
  expect(contentRequests.some((url) => url.endsWith("large.txt"))).toBe(false);
  await preview.getByRole("button", { name: "Close window" }).click();

  await cloud.getByRole("button", { name: "clip.mp4", exact: true }).dblclick();
  preview = page.locator('.desktop-window[data-window-kind="cloudPreview"]');
  await expect(preview.locator("video")).toHaveAttribute("src", "https://115-preview.example/clip.mp4");
  await preview.getByRole("button", { name: "Close window" }).click();

  await cloud.getByRole("button", { name: "archive.zip", exact: true }).dblclick();
  const dialog = cloud.getByRole("dialog", { name: "在线解压" });
  await expect(dialog).toBeVisible();
  expect(calls.filter((call) => call.method === "extract")).toHaveLength(0);
  await dialog.locator('input[type="password"]').fill("archive-password");
  await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect.poll(() => calls.some((call) => call.method === "extract")).toBe(true);
  expect(calls.find((call) => call.method === "extract")!.params).toMatchObject({ ids: ["6"], password: "archive-password" });
  expect(calls.some((call) => call.method === "download")).toBe(false);
  expect(errors).toEqual([]);
});

test("multiple progress windows can be dragged and closed independently in compact mode", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
  const jobs = ["a", "b"].map((id) => ({ id, type: "copy", status: "running", actorId: 1, sourceRootId: "local", progressDone: 0, progressTotal: 1, failedCount: 0, cancelRequested: false, errorMessage: "", createdAtUnix: 1, updatedAtUnix: 1, eventVersion: 1, transfer: { phase: "copy", file: `${id}.txt`, bytesDone: 1, bytesTotal: 100, bytesPerSecond: 1, cancelable: true } }));
  const cancelRequests: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: `event: jobs.snapshot\ndata: ${JSON.stringify({ runtimeId: "progress", cursor: 0, reset: false, jobs })}\n\n` });
    if (path.endsWith("/cancel")) cancelRequests.push(path);
    const data = path === "/api/init/status" ? { needsInitialization: false } : path === "/api/auth/me" ? { id: 1, username: "admin" } : [];
    return route.fulfill({ json: { data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch to compact mode" }).click();
  expect(await page.locator(".system-taskbar").evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
  for (let index = 0; index < 2; index++) {
    await page.getByRole("button", { name: "Jobs", exact: true }).click();
    await page.getByRole("button", { name: "View progress", exact: true }).nth(index).click();
  }
  // The last opened window is on top; both initially share the viewport center.
  const first = page.locator('[data-progress-job="a"]');
  const second = page.locator('[data-progress-job="b"]');
  await expect(first).toBeVisible(); await expect(second).toBeVisible();
  const before = (await first.boundingBox())!;
  const other = (await second.boundingBox())!;
  const header = (await first.locator(".desktop-window-titlebar").boundingBox())!;
  expect(Math.abs(before.x + before.width / 2 - 700)).toBeLessThan(2);
  expect(Math.abs(before.y + before.height / 2 - 450)).toBeLessThan(2);
  // Jobs are newest-first (b, a), so a was opened last and is on top.
  await page.mouse.move(header.x + header.width - 55, header.y + header.height / 2);
  await page.mouse.down(); await page.mouse.move(300, 180, { steps: 15 }); await page.mouse.up();
  await expect.poll(async () => (await first.boundingBox())!.x).not.toBe(before.x);
  expect((await second.boundingBox())!.x).toBe(other.x);
  await first.getByRole("button", { name: "Run in background" }).click();
  await expect(first).toHaveCount(0); await expect(second).toBeVisible();
  const close = second.getByRole("button", { name: "Close window" });
  await close.hover();
  await expect(close).toHaveCSS("background-color", "rgb(220, 38, 38)");
  await expect(close).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(close).toHaveCSS("width", "38px");
  await expect(close).toHaveCSS("height", "34px");
  await close.click();
  await expect(second).toHaveCount(0);
  expect(cancelRequests).toEqual([]);
});
