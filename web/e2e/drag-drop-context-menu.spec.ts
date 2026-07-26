import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type OpsPayload = {
  type: "move" | "copy";
  sourceRoot: string;
  sources: string[];
  destRoot: string;
  destPath: string;
};

test("previews same-pane and cross-pane drops with Windows-style defaults", async ({ page }) => {
  const { dryRuns } = await installMockApi(page);
  await page.goto("/");
  const left = page.getByRole("region", { name: "Left pane" });
  const right = page.getByRole("region", { name: "Right pane" });
  await expect(entryRow(left, "source.txt")).toBeVisible();
  await expect(entryRow(right, "folder")).toBeVisible();

  const dryRunCount = dryRuns.length;
  await dragFileTo(page, entryRow(left, "folder"), entryRow(right, "folder"));
  await expect(page.getByText("A folder cannot be placed inside itself or one of its subfolders")).toBeVisible();
  await expect.poll(() => dryRuns.length).toBe(dryRunCount);

  const samePaneDryRunCount = dryRuns.length;
  await dragFileTo(page, entryRow(left, "source.txt"), entryRow(left, "folder"));
  await expect.poll(() => dryRuns.length).toBeGreaterThan(samePaneDryRunCount);
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "move", sourceRoot: "data", sources: ["source.txt"], destRoot: "data", destPath: "folder",
  });
  let dialog = page.getByRole("dialog", { name: "move preview" });
  await expect(dialog.getByRole("radio", { name: "move" })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const sameRootDryRunCount = dryRuns.length;
  await dragFileTo(page, entryRow(left, "source.txt"), entryRow(right, "folder"));
  await expect.poll(() => dryRuns.length).toBeGreaterThan(sameRootDryRunCount);
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "move", sourceRoot: "data", destRoot: "data", destPath: "folder",
  });
  dialog = page.getByRole("dialog", { name: "move preview" });
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await right.getByRole("combobox", { name: "Right pane root" }).selectOption("archive");
  await expect(entryRow(right, "archive.txt")).toBeVisible();
  const differentRootDryRunCount = dryRuns.length;
  await dragFileTo(page, entryRow(left, "source.txt"), entryRow(right, "archive.txt"));
  await expect.poll(() => dryRuns.length).toBeGreaterThan(differentRootDryRunCount);
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "copy", sourceRoot: "data", destRoot: "archive", destPath: ".",
  });
  dialog = page.getByRole("dialog", { name: "copy preview" });
  await expect(dialog.getByRole("radio", { name: "copy" })).toBeChecked();

  const switchedDryRunCount = dryRuns.length;
  await dialog.getByRole("radio", { name: "move" }).click();
  await expect.poll(() => dryRuns.length).toBeGreaterThan(switchedDryRunCount);
  await expect.poll(() => dryRuns.at(-1)?.type).toBe("move");
  dialog = page.getByRole("dialog", { name: "move preview" });
  await expect(dialog.getByRole("button", { name: "Start move" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("uses row and whitespace context selection while keeping all actions visible", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const left = page.getByRole("region", { name: "Left pane" });
  await expect(entryRow(left, "source.txt")).toBeVisible();

  await left.getByLabel("Select source.txt").click();
  await left.getByLabel("Select folder").click();
  await entryRow(left, "source.txt").click({ button: "right" });
  let menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu.locator('[data-action-id="rename"]')).toHaveAttribute("aria-disabled", "true");
  await expect(menu.locator('[data-action-id="powerRename"]')).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await entryRow(left, "peer.txt").click({ button: "right" });
  menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu.locator('[data-action-id="rename"]')).not.toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await openBlankContextMenu(left.getByTestId("file-list-left"));
  menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu.locator("[data-action-id]")).toHaveCount(8);
  await expect(menu.locator('[data-action-id="mkdir"]')).not.toHaveAttribute("aria-disabled", "true");
  for (const id of ["copy", "move", "symlink", "hardlink", "rename", "powerRename", "delete"]) {
    await expect(menu.locator(`[data-action-id="${id}"]`)).toHaveAttribute("aria-disabled", "true");
  }

  await expect(menu).toBeInViewport();
  await page.screenshot({ path: "test-results/file-context-menu-1440x900.png", fullPage: true });

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1024, height: 768 });
  await openBlankContextMenu(left.getByTestId("file-list-left"));
  menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu).toBeInViewport();
  await expect(menu.locator("[data-action-id]")).toHaveCount(8);
  await page.screenshot({ path: "test-results/file-context-menu-1024x768.png", fullPage: true });
});

test("confirms a ready operation with Enter without opening Jobs", async ({ page }) => {
  const { createdJobs } = await installMockApi(page);
  await page.goto("/");
  const left = page.getByRole("region", { name: "Left pane" });
  await expect(entryRow(left, "source.txt")).toBeVisible();

  await left.getByLabel("Select source.txt").click();
  await page.getByRole("button", { name: "Copy to right pane" }).click();
  const dialog = page.getByRole("dialog", { name: "copy preview" });
  await expect(dialog.getByRole("button", { name: "Start copy" })).toBeEnabled();
  await expect(dialog).toBeFocused();

  await page.keyboard.press("Enter");

  await expect.poll(() => createdJobs.length).toBe(1);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Jobs" })).toHaveCount(0);
});

function entryRow(pane: Locator, name: string) {
  return pane.locator("tbody tr").filter({ hasText: name });
}

async function dragFileTo(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("drag source or target has no bounding box");
  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 8, sourceY, { steps: 2 });
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();
}

async function openBlankContextMenu(fileList: Locator) {
  const box = await fileList.boundingBox();
  if (!box) throw new Error("file list has no bounding box");
  await fileList.click({
    button: "right",
    position: { x: box.width - 20, y: box.height - 20 },
  });
}

async function installMockApi(page: Page) {
  const dryRuns: OpsPayload[] = [];
  const createdJobs: OpsPayload[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["en-US"] });
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/init/status") return respond(route, { needsInitialization: false });
    if (url.pathname === "/api/auth/me") return respond(route, { id: 1, username: "admin" });
    if (url.pathname === "/api/roots") {
      return respond(route, [{ id: "data", name: "Data" }, { id: "archive", name: "Archive" }]);
    }
    if (url.pathname === "/api/browse") {
      return respond(route, url.searchParams.get("rootId") === "archive" ? archiveEntries : dataEntries);
    }
    if (url.pathname === "/api/ops/dry-run") {
      const payload = request.postDataJSON() as OpsPayload;
      dryRuns.push(payload);
      const base = payload.sources[0]?.split("/").at(-1) ?? "";
      const destination = payload.destPath === "." ? base : `${payload.destPath}/${base}`;
      return respond(route, {
        hasConflict: false,
        items: [{
          operation: payload.type,
          sourceRoot: payload.sourceRoot,
          sourcePath: payload.sources[0],
          destRoot: payload.destRoot,
          destPath: destination,
          conflict: false,
        }],
      });
    }
    if (url.pathname === "/api/ops/jobs") {
      createdJobs.push(request.postDataJSON() as OpsPayload);
      return respond(route, { id: "job-1" });
    }
    if (url.pathname === "/api/jobs" && request.method() === "GET") return respond(route, []);
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_mocked", message: url.pathname } }),
    });
  });
  return { dryRuns, createdJobs };
}

async function respond(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  });
}

const dataEntries = [
  { name: "source.txt", relativePath: "source.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "folder", relativePath: "folder", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "peer.txt", relativePath: "peer.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
];

const archiveEntries = [
  { name: "archive-folder", relativePath: "archive-folder", type: "directory", size: 0, mode: "", modifiedUnix: 0, isSymlink: false },
  { name: "archive.txt", relativePath: "archive.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
];
