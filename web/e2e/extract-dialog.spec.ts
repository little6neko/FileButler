import { expect, test } from "@playwright/test";

test("extraction picker uses a blue selection outline and Enter commits the full path", async ({ page }) => {
  const submissions: unknown[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    localStorage.setItem("filebutler.workspace-mode", "compact");
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = {};
    if (url.pathname === "/api/init/status") data = { needsInitialization: false };
    else if (url.pathname === "/api/auth/me") data = { id: 1, username: "test" };
    else if (url.pathname === "/api/roots") data = [{ id: "a", name: "A" }];
    else if (url.pathname === "/api/browse") {
      const path = url.searchParams.get("path");
      if (path === "missing") return route.fulfill({ status: 400, json: { error: { code: "invalid_path", message: "Directory not found" } } });
      data = path === "." ? [
        { name: "archive.zip", relativePath: "archive.zip", type: "file", size: 100, modifiedUnix: 0, isSymlink: false },
        { name: "parent", relativePath: "parent", type: "directory", size: 0, modifiedUnix: 0, isSymlink: false },
      ] : path === "parent" ? [
        { name: "child", relativePath: "parent/child", type: "directory", size: 0, modifiedUnix: 0, isSymlink: false },
      ] : [];
    } else if (url.pathname === "/api/jobs/events") {
      return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"picker","cursor":0,"reset":false,"jobs":[]}\n\n' });
    } else if (url.pathname === "/api/extract/jobs") {
      submissions.push(route.request().postDataJSON());
      data = { id: "extract" };
    }
    await route.fulfill({ json: { data } });
  });
  await page.goto("/");
  await page.getByRole("region", { name: "Left pane" }).getByText("archive.zip", { exact: true }).dblclick();
  const dialog = page.getByRole("dialog", { name: "Extract archive", exact: true });
  const input = dialog.getByLabel("Destination path");
  await expect(input).toHaveValue("/");
  await dialog.getByRole("button", { name: "Browse", exact: true }).click();
  const folder = dialog.getByRole("button", { name: "parent", exact: true });
  await folder.click();
  await expect(folder).toHaveAttribute("data-selected", "true");
  await expect(input).toHaveValue("/");
  const blue = await folder.evaluate((element) => getComputedStyle(element).getPropertyValue("--color-blue-500").trim());
  expect(blue).not.toBe("");
  await expect(folder).toHaveCSS("--tw-ring-color", blue);
  await expect(folder).toHaveCSS("box-shadow", /0px 0px 0px 2px inset/);
  await folder.hover();
  await page.mouse.down();
  await expect(folder).toHaveCSS("translate", "none");
  await page.mouse.up();
  await folder.dblclick();
  await expect(input).toHaveValue("/parent");
  await dialog.getByRole("button", { name: "child", exact: true }).dblclick();
  await expect(input).toHaveValue("/parent/child");
  await dialog.getByRole("button", { name: "Up", exact: true }).click();
  await expect(input).toHaveValue("/parent");
  await input.fill("/parent/child/");
  await input.press("Enter");
  await expect(input).toHaveValue("/parent/child");
  expect(submissions).toHaveLength(0);
  await input.fill("/missing");
  await input.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("Directory not found");
  await expect(input).toHaveValue("/parent/child");
  expect(submissions).toHaveLength(0);
});
