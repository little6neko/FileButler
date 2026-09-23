import { expect, test, type Locator, type Page } from "@playwright/test";

async function setup(page: Page, compact = false) {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript((compact) => {
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN"] });
    localStorage.setItem("filebutler.workspace-mode", compact ? "compact" : "desktop");
  }, compact);
  const calls: { path: string; params: Record<string, unknown> }[] = [];
  const names = ["archive.tar.gz", "photos.2026", "archive.zip"];
  const groups = Array.from({ length: 25 }, (_, i) => ({
    path: `Album${i}`, name: `Album${i}`,
    images: [{ sourcePath: `Album${i}/old.jpg`, name: "old.jpg", extension: ".jpg", mediaKind: "image" }],
    videos: [], unmatched: [], childDirectories: [], directOccupiedPaths: [`Album${i}/old.jpg`], recoveryResidues: [],
    videoDirectory: { path: `Album${i}/视频`, status: "missing", occupiedPaths: [] },
  }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/roots") data = [{ id: "a", name: "A", path: "/a" }];
    else if (path === "/api/browse") data = names.map((name, i) => ({ name, relativePath: name, type: i === 1 ? "directory" : "file", size: 42, modifiedUnix: 1, mode: "", isSymlink: false }));
    else if (path === "/api/cloud115/accounts") data = [{ accountId: "7", name: "测试账号", avatar: "", usedBytes: 1, totalBytes: 2 }];
    else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/profile") data = { accountId: "7", name: "测试账号" };
    else if (path === "/api/cloud115/browse") data = { entries: names.map((name, i) => ({ id: String(i + 1), parentId: "0", name, size: 42, isDirectory: i === 1 })), offset: 0, total: 3 };
    else if (path.includes("super") && path.endsWith("preview")) data = { rootId: path.includes("cloud115") ? "@115" : "a", directoryPath: ".", generatedAtUnix: 1, revision: "groups", groups };
    else if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"styles","cursor":0,"reset":false,"jobs":[]}\n\n' });
    else if (route.request().method() === "POST") {
      calls.push({ path, params: route.request().postDataJSON() });
      data = { id: "test-job" };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  return calls;
}

async function fullFooter(container: Locator) {
  const footer = container.locator('[data-slot="dialog-footer"]');
  await expect(footer).toBeVisible();
  await container.evaluate((el) => Promise.all(el.getAnimations().map((animation) => animation.finished)));
  const outer = (await container.boundingBox())!;
  const bar = (await footer.boundingBox())!;
  expect(Math.abs(bar.x - outer.x)).toBeLessThan(2);
  expect(Math.abs(bar.width - outer.width)).toBeLessThan(2);
  expect(Math.abs(bar.y + bar.height - outer.y - outer.height)).toBeLessThan(2);
  const style = await footer.evaluate((el) => {
    const s = getComputedStyle(el);
    return { background: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow };
  });
  expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.border).toBe("1px");
  expect(style.shadow).toBe("none");
}

test("115 shares name dialogs and uses matching full-width footers and input styling", async ({ page }) => {
  const calls = await setup(page);
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await cloud.getByRole("button", { name: /测试账号/ }).dblclick();
  await cloud.getByRole("button", { name: "新建文件夹", exact: true }).click();
  let dialog = cloud.getByRole("dialog", { name: "新建文件夹" });
  const nameInput = dialog.getByRole("textbox", { name: "文件夹名称" });
  await expect(nameInput).toBeFocused();
  const standard = await nameInput.evaluate((el) => ({ radius: getComputedStyle(el).borderRadius, height: el.getBoundingClientRect().height }));
  await fullFooter(dialog);
  await nameInput.fill("  新文件夹  ");
  await nameInput.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(calls.find((call) => call.path.endsWith("/mkdir"))?.params).toMatchObject({ accountId: "7", parentId: "0", name: "新文件夹" });

  for (const [name, end] of [["archive.tar.gz", 11], ["photos.2026", 11]] as const) {
    await cloud.getByRole("button", { name, exact: true }).click();
    await cloud.getByRole("button", { name: "重命名", exact: true }).click();
    dialog = cloud.getByRole("dialog", { name: "重命名" });
    const input = dialog.getByRole("textbox", { name: "新名称" });
    await expect(input).toBeFocused();
    expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, end]);
    await fullFooter(dialog);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
  }

  await cloud.getByRole("button", { name: "archive.zip", exact: true }).dblclick();
  dialog = cloud.getByRole("dialog", { name: "在线解压" });
  const password = dialog.getByLabel("解压密码", { exact: true });
  expect(await password.evaluate((el) => ({ radius: getComputedStyle(el).borderRadius, height: el.getBoundingClientRect().height }))).toEqual(standard);
  await fullFooter(dialog);
  await password.fill("secret");
  await password.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(calls.find((call) => call.path.endsWith("/extract"))?.params).toMatchObject({ accountId: "7", ids: ["3"], destId: "0", password: "secret" });

  await cloud.getByRole("button", { name: "离线下载", exact: true }).click();
  dialog = cloud.getByRole("dialog", { name: "离线下载" });
  const links = dialog.getByRole("textbox", { name: "下载链接" });
  expect(await links.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(standard.radius);
  await fullFooter(dialog);
  await links.fill(Array.from({ length: 30 }, (_, i) => `https://example.com/${i}`).join("\n"));
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(dialog.getByText("已提交到115", { exact: true })).toHaveCount(30);
  await fullFooter(dialog);
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
  await page.screenshot({ path: "/tmp/filebutler-unified-offline.png" });
  await page.setViewportSize({ width: 900, height: 450 });
  await fullFooter(dialog);
  await expect(dialog.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
});

for (const compact of [false, true]) {
  test(`local mkdir and SuperRename fill their footer in ${compact ? "compact" : "desktop"} mode`, async ({ page }) => {
    await setup(page, compact);
    if (!compact) {
      await page.getByRole("button", { name: "打开文件管理器", exact: true }).click();
      await page.getByRole("button", { name: /^A/ }).dblclick();
    }
    const files = compact ? page.getByRole("region", { name: "左栏", exact: true }) : page.locator('.desktop-window[data-window-kind="file"]');
    const toolbar = compact ? page : files;
    await toolbar.getByRole("button", { name: "新建文件夹", exact: true }).click();
    const mkdir = page.getByRole("dialog", { name: "新建文件夹", exact: true });
    await fullFooter(mkdir);
    await mkdir.getByRole("button", { name: "取消", exact: true }).click();
    await toolbar.getByRole("button", { name: "SuperRename", exact: true }).click();
    const container = compact ? page.getByRole("dialog", { name: "SuperRename", exact: true }) : page.locator(".super-rename-window-layout");
    const scroll = page.getByTestId("super-rename-tree-scroll");
    await expect(scroll).toBeVisible();
    await fullFooter(container);
    const footer = container.locator('[data-slot="dialog-footer"]');
    const before = await footer.boundingBox();
    await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
    expect(await footer.boundingBox()).toEqual(before);
    await fullFooter(container);
    await page.screenshot({ path: `/tmp/filebutler-unified-super-${compact ? "compact" : "desktop"}.png` });
  });
}
