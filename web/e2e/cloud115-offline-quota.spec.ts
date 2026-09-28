import { expect, test } from "@playwright/test";

test("offline quota shares destination typography, refreshes per batch and allows retry", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
  let quotaCalls = 0;
  let browseCalls = 0;
  const submissions: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "test" };
    else if (path === "/api/roots") data = [];
    else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/accounts") data = [{ accountId: "7", name: "Quota tester", avatar: "", usedBytes: 1, totalBytes: 2 }];
    else if (path === "/api/cloud115/profile") data = { accountId: "7", name: "Quota tester" };
    else if (path === "/api/cloud115/browse") { browseCalls++; data = { entries: [], offset: 0, total: 0 }; }
    else if (path === "/api/cloud115/offline.quota") {
      quotaCalls++;
      expect(route.request().postDataJSON()).toEqual({ accountId: "7" });
      if (quotaCalls === 2) return route.fulfill({ status: 502, json: { error: { message: "quota query failed" } } });
      data = { used: quotaCalls === 1 ? 128 : 129, total: 2000, remaining: quotaCalls === 1 ? 1872 : 1871 };
    } else if (path === "/api/cloud115/offline.add") {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) return route.fulfill({ status: 502, json: { error: { message: "submission failed" } } });
      data = { submitted: true };
    } else if (path === "/api/jobs/events") {
      return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"quota","cursor":0,"reset":false,"jobs":[]}\n\n' });
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开115网盘", exact: true }).click();
  const cloud = page.locator('.desktop-window[data-window-kind="cloud115"]');
  await cloud.getByRole("button", { name: /Quota tester/ }).dblclick();
  await cloud.getByRole("button", { name: "离线下载", exact: true }).click();
  const dialog = cloud.getByRole("dialog", { name: "离线下载", exact: true });
  const text = dialog.getByText("离线配额：剩余 1,872 / 2,000", { exact: true });
  await expect(text).toBeVisible();
  const typography = await dialog.getByText(/^保存到：/).evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: style.fontSize, color: style.color, weight: style.fontWeight };
  });
  await expect(text).toHaveCSS("font-size", typography.size);
  await expect(text).toHaveCSS("color", typography.color);
  await expect(text).toHaveCSS("font-weight", typography.weight);
  const input = dialog.getByRole("textbox", { name: "下载链接" });
  expect((await text.boundingBox())!.y).toBeGreaterThan((await input.boundingBox())!.y + (await input.boundingBox())!.height);
  await input.fill("https://example.com/file");
  expect(quotaCalls).toBe(1);
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(dialog.getByText("配额获取失败", { exact: true })).toBeVisible();
  expect(quotaCalls).toBe(2);
  expect(submissions).toEqual([{ url: "https://example.com/file", destId: "0", accountId: "7" }]);
  await dialog.getByRole("button", { name: "重试", exact: true }).click();
  await expect(dialog.getByText("离线配额：剩余 1,871 / 2,000", { exact: true })).toBeVisible();
  expect(quotaCalls).toBe(3);
  const beforeRefresh = browseCalls;
  await dialog.getByRole("button", { name: "提交", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => browseCalls).toBe(beforeRefresh + 1);
  expect(quotaCalls).toBe(3);
  expect(submissions).toHaveLength(2);
  expect(errors).toEqual([]);
});
