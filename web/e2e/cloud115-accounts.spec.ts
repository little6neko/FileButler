import { expect, test } from "@playwright/test";

test("account home, independent windows, account-bound requests and cross-account paste rejection", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["zh-CN"] }));
  const accounts = ["1", "2"].map((id) => ({ accountId: id, name: `账号${id}`, avatar: "", usedBytes: 1024, totalBytes: 2048 }));
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const errors: string[] = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"accounts","cursor":0,"reset":false,"jobs":[]}\n\n' });
    else if (path.startsWith("/api/cloud115/")) {
      const method = path.split("/").at(-1)!; const params = route.request().postDataJSON(); requests.push({ method, params });
      if (method === "accounts") data = accounts;
      else if (method === "status") data = { loggedIn: true };
      else if (method === "profile") data = accounts.find((a) => a.accountId === params.accountId);
      else if (method === "browse") data = { entries: [{ id: "1", name: "same.txt", parentId: "0", isDirectory: false, size: 1 }], offset: 0, total: 1 };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  const icon = page.getByRole("button", { name: "打开115网盘", exact: true });
  await icon.click();
  const windows = page.locator('.desktop-window[data-window-kind="cloud115"]');
  const first = windows.nth(0);
  await expect(first.getByTestId("cloud-accounts")).toBeVisible();
  await expect(first.getByRole("progressbar", { name: "账号1空间占用" })).toHaveAttribute("aria-valuenow", "50");
  const add = first.getByRole("button", { name: "添加新账号" });
  expect(await add.evaluate((element) => getComputedStyle(element).display)).toBe("flex");
  expect(await add.evaluate((element) => element === element.parentElement!.lastElementChild)).toBe(true);
  await first.getByRole("button", { name: /^账号1/ }).click();
  await expect(first.getByRole("button", { name: "same.txt", exact: true })).toBeVisible();
  await first.getByRole("button", { name: "same.txt", exact: true }).click();
  await page.keyboard.press("Control+c");
  await icon.click();
  const second = windows.nth(1);
  await expect(second.getByTestId("cloud-accounts")).toBeVisible();
  await second.getByRole("button", { name: /^账号2/ }).click();
  await expect(second.getByRole("button", { name: "same.txt", exact: true })).toBeVisible();
  await page.keyboard.press("Control+v");
  await expect(second.getByRole("dialog")).toHaveCount(0);
  await second.getByRole("button", { name: "same.txt", exact: true }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "粘贴", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");
  expect(requests.filter((r) => r.method.startsWith("ops."))).toHaveLength(0);
  expect(requests.filter((r) => r.method === "browse").map((r) => r.params.accountId)).toEqual(["1", "2"]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("cloud115-account-changed", { detail: { accountId: "1" } })));
  await expect(first.getByTestId("cloud-accounts")).toBeVisible();
  await expect(second.getByRole("button", { name: "same.txt", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "/tmp/filebutler-multi-account-windows.png" });
});
