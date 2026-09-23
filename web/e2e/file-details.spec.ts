import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, cloud = false, compact = false) {
  const calls: { section: string; paths: string[] }[] = [];
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(({ compact }) => {
    Object.defineProperty(navigator, "languages", { get: () => ["zh-CN"] });
    if (compact) localStorage.setItem("filebutler.workspace-mode", "compact");
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => sessionStorage.setItem("copied-path", text) } });
  }, { compact });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"details","cursor":0,"reset":false,"jobs":[]}\n\n' });
    else if (path === "/api/roots") data = [{ id: "a", name: "A" }];
    else if (path === "/api/browse") data = ["a.txt", "movie.avi"].map((name) => ({ name, relativePath: name, type: "file", size: 65982, mode: "0644", modifiedUnix: 1, isSymlink: false }));
    else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/profile") data = { accountId: "7", name: "Cloud" };
    else if (path === "/api/cloud115/browse") data = { entries: [{ id: "1", parentId: "0", name: "a.txt", size: 65982, isDirectory: false }, { id: "2", parentId: "0", name: "movie.avi", size: 65982, isDirectory: false }], total: 2, offset: 0 };
    else if (path.includes("details")) {
      const request = route.request().postDataJSON();
      const section = path.split(/[/.]/).at(-1)!; const paths = request.paths ?? request.ids; calls.push({ section, paths });
      if (section === "basic") data = paths.map((id: string) => ({ name: id === "." || id === "0" ? "A" : id === "1" ? "a.txt" : id === "2" ? "movie.avi" : id, type: id === "." || id === "0" ? "directory" : "file", path: id, location: cloud ? "/cloud" : "/files", size: 65982, allocated: cloud ? null : 69632, modifiedUnix: 1, createdUnix: null, sha1: "" }));
      else if (section === "stats") { await new Promise((resolve) => setTimeout(resolve, 300)); data = { size: 131964, allocated: cloud ? null : 139264, files: 2, folders: 0 }; }
      else if (section === "hash") data = { sha1: "A".repeat(40) };
    }
    return route.fulfill({ json: { data } });
  });
  await page.goto("/");
  if (cloud) await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  else if (!compact) { await page.getByRole("button", { name: "打开文件管理器", exact: true }).click(); await page.getByRole("button", { name: /^A/ }).dblclick(); }
  return calls;
}

test("local details supports independent windows, SHA1 refresh and blank-directory context", async ({ page }) => {
  const calls = await setup(page);
  const files = page.locator('.desktop-window[data-window-kind="file"]');
  await files.getByRole("button", { name: "a.txt", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "文件操作", exact: true });
  await expect(menu.getByRole("menuitem").last()).toHaveText("详细信息");
  await menu.getByRole("menuitem", { name: "详细信息" }).click();
  const details = page.locator('.desktop-window[data-window-kind="details"]');
  await expect(details).toHaveCount(1);
  await expect(details.getByText("64.44 KB（65,982 字节）", { exact: true })).toBeVisible();
  await expect(details.getByText("共包含", { exact: true })).toHaveCount(0);
  expect(calls.map((call) => call.section)).toEqual(["basic"]);
  async function expectInlineButtons() {
    for (const name of ["复制原始路径", "重新获取"]) {
      const button = details.getByRole("button", { name, exact: true });
      await expect(button).toHaveAttribute("data-variant", "outline");
      const gap = await button.evaluate((element) => {
        const value = element.parentElement!.querySelector("span")!;
        return element.getBoundingClientRect().left - value.getBoundingClientRect().right;
      });
      expect(gap).toBeCloseTo(8, 0);
      const grows = await button.evaluate((element) => getComputedStyle(element.parentElement!.querySelector("span")!).flexGrow);
      expect(grows).toBe("0");
    }
  }
  await expectInlineButtons();
  await details.getByRole("button", { name: "复制原始路径" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("copied-path"))).toBe("/files");
  await details.getByRole("button", { name: "重新获取" }).click();
  await expect(details.getByText("A".repeat(40), { exact: true })).toBeVisible();
  await expectInlineButtons();
  await details.getByRole("button", { name: "最小化窗口" }).click();
  await files.locator(".file-list").click({ button: "right", position: { x: 20, y: 200 } });
  await page.getByRole("menuitem", { name: "详细信息" }).click();
  await expect(details.getByText("计算中...", { exact: true }).first()).toBeVisible();
  await expect(details.getByText("2个文件，0个文件夹", { exact: true })).toBeVisible();
  expect(calls.at(-1)?.paths).toEqual(["."]);
  await page.screenshot({ path: "/tmp/filebutler-details-local.png" });
});

test("115 more menu uses one multi-selection details window", async ({ page }) => {
  const calls = await setup(page, true);
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await cloud.getByRole("checkbox", { name: "选择 a.txt", exact: true }).check();
  await cloud.getByRole("checkbox", { name: "选择 movie.avi", exact: true }).check();
  await cloud.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "详细信息" }).click();
  const details = page.getByTestId("file-details");
  await expect(details.getByText("a.txt 等 2 项", { exact: true })).toBeVisible();
  await expect(details.getByText("多种类型", { exact: true })).toBeVisible();
  await expect(details.getByText("2个文件，0个文件夹", { exact: true })).toBeVisible();
  for (const name of ["分辨率", "时长", "修改时间", "创建时间", "SHA1"]) await expect(details.getByText(name, { exact: true })).toHaveCount(0);
  expect(calls.at(-1)?.paths).toEqual(["1", "2"]);
});

test("compact mode supports the same details window and minimize/restore", async ({ page }) => {
  await setup(page, false, true);
  const pane = page.getByRole("region", { name: "左栏", exact: true });
  await pane.getByRole("button", { name: "movie.avi", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "详细信息" }).click();
  const details = page.locator('.desktop-window[data-window-kind="details"]');
  await expect(details.getByText("avi", { exact: true })).toBeVisible();
  await expect(details.getByText("分辨率", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Control+A");
  await expect(pane.getByRole("checkbox", { name: "选择 a.txt", exact: true })).not.toBeChecked();
  await details.getByRole("button", { name: "最小化窗口" }).click();
  await page.locator('.taskbar-window-button[data-window-kind="details"]').click();
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "关闭窗口" }).click();
  await expect(details).toHaveCount(0);
});
