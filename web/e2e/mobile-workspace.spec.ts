import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, compact = false) {
  await page.addInitScript(({ compact }) => {
    Object.defineProperty(navigator, "languages", { get: () => ["en-US"] });
    localStorage.setItem("filebutler.workspace-mode", compact ? "compact" : "desktop");
  }, { compact });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith("/api/")) return route.continue();
    let data: unknown = [];
    if (path === "/api/init/status") data = { needsInitialization: false };
    else if (path === "/api/auth/me") data = { id: 1, username: "admin" };
    else if (path === "/api/roots") data = [{ id: "a", name: "Test A" }, { id: "b", name: "Test B" }];
    else if (path === "/api/jobs/events") return route.fulfill({ contentType: "text/event-stream", body: 'event: jobs.snapshot\ndata: {"runtimeId":"mobile","cursor":0,"reset":false,"jobs":[]}\n\n' });
    else if (path === "/api/browse") {
      const parent = url.searchParams.get("path");
      data = ["Folder", "preview.png", ...Array.from({ length: 60 }, (_, i) => `sample-${i}.txt`)].map(name => ({ name, relativePath: parent && parent !== "." ? `${parent}/${name}` : name, type: name === "Folder" ? "directory" : "file", size: 1024, mode: "0644", modifiedUnix: 1, isSymlink: false }));
    } else if (path === "/api/rename/preview") {
      const request = route.request().postDataJSON();
      data = { hasConflict: false, items: request.paths.map((name: string) => ({ sourcePath: name, oldName: name, newName: `new-${name}`, changed: true, conflict: false })) };
    } else if (path === "/api/super-rename/preview") {
      data = { rootId: "a", directoryPath: ".", generatedAtUnix: 1, groups: ["Album A", "Album B"].map(name => ({
        path: name, name,
        images: Array.from({ length: 25 }, (_, i) => ({ sourcePath: `${name}/photo-${i}.jpg`, name: `photo-${i}.jpg`, extension: ".jpg", mediaKind: "image" })),
        videos: [{ sourcePath: `${name}/clip.mp4`, name: "clip.mp4", extension: ".mp4", mediaKind: "video" }],
        unmatched: [{ path: `${name}/notes.txt`, name: "notes.txt", kind: "file", reason: "unsupported-extension" }],
        childDirectories: [], directOccupiedPaths: [], recoveryResidues: [], videoDirectory: { status: "missing", path: `${name}/视频`, occupiedPaths: [] },
      })) };
    } else if (path === "/api/cloud115/accounts" || path === "/api/cloud115/profile") {
      const profile = { accountId: "7", name: "Cloud tester", avatar: "", usedBytes: 1, totalBytes: 2 };
      data = path.endsWith("accounts") ? [profile] : profile;
    } else if (path === "/api/cloud115/status") data = { loggedIn: true };
    else if (path === "/api/cloud115/browse") data = { entries: [{ id: "1", parentId: "0", name: "Cloud folder", size: 0, isDirectory: true }], total: 1, offset: 0 };
    return route.fulfill({ json: { data } });
  });
  await page.goto("/");
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const pane = page.locator(".file-pane:visible").first();
  if (await pane.count()) expect(await pane.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

for (const width of [360, 390, 430]) {
  test(`mobile ${width}: tap navigation, selection, action sheet and PowerRename`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    await page.getByRole("button", { name: "Open File Manager", exact: true }).click();
    await page.getByRole("button", { name: "Test A /", exact: true }).click();
    const pane = page.locator(".file-pane:visible");
    await expect(pane.getByText("sample-0.txt", { exact: true })).toBeVisible();
    const frame = page.locator('.desktop-window[data-active="true"]');
    const title = await frame.locator(".desktop-window-titlebar").boundingBox();
    const content = await frame.locator(".desktop-window-content").boundingBox();
    expect(title!.height).toBe(48);
    expect(content!.y).toBeCloseTo(title!.y + title!.height, 0);
    for (const selector of [".desktop-window-titlebar > svg", ".desktop-window-titlebar > strong", ".desktop-window-controls button:visible"]) {
      const child = await frame.locator(selector).boundingBox();
      expect(Math.abs(child!.y + child!.height / 2 - (title!.y + title!.height / 2))).toBeLessThanOrEqual(1);
    }
    await noHorizontalOverflow(page);
    expect((await pane.locator(".pane-header .pane-location-trigger").boundingBox())!.width).toBeLessThanOrEqual(132);
    const sortMenu = pane.locator(".mobile-sort-controls .pane-location-trigger");
    await expect(pane.locator(".mobile-sort-controls select")).toHaveCount(0);
    await sortMenu.click();
    const popup = page.getByRole("menu", { name: "Name / Modified", exact: true });
    await popup.getByRole("menuitem", { name: "Size", exact: true }).click();
    await expect(sortMenu).toHaveText("Size");
    await sortMenu.click();
    await popup.getByRole("menuitem", { name: "Name", exact: true }).click();
    await expect(sortMenu).toHaveText("Name");
    const controlsBounds = await pane.locator(".mobile-list-controls").boundingBox();
    expect(controlsBounds!.height).toBe(40);
    expect((await pane.locator(".pane-header").boundingBox())!.height).toBe(80);
    expect((await pane.locator(".path-segments").boundingBox())!.height).toBe(40);
    expect((await pane.locator(".file-table tbody tr").first().boundingBox())!.height).toBe(52);
    await pane.getByRole("button", { name: "Folder", exact: true }).click();
    await expect(pane).toHaveAttribute("data-directory-path", "Folder");
    await page.goBack();
    await expect(pane).toHaveAttribute("data-directory-path", ".");
    await pane.getByRole("button", { name: "Select", exact: true }).click();
    await noHorizontalOverflow(page);
    await expect(pane.locator(".mobile-list-controls")).toHaveCSS("border-bottom-width", "1px");
    expect((await pane.locator(".file-table tbody tr").first().boundingBox())!.height).toBe(52);
    for (const button of await pane.locator(".mobile-list-controls button").all()) {
      await expect(button).toHaveCSS("border-top-width", "1px");
    }
    await expect(pane.locator("td.select-cell").first()).toHaveCSS("border-right-width", "0px");
    await expect(pane.locator("td.select-cell").first()).toHaveCSS("border-bottom-width", "0px");
    await pane.getByText("sample-0.txt", { exact: true }).click();
    await expect(pane.getByRole("checkbox", { name: "Select sample-0.txt", exact: true })).toBeChecked();
    await page.locator(".mobile-selection-actions").getByRole("button", { name: "More", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "File actions", exact: true });
    await sheet.getByRole("button", { name: "PowerRename", exact: true }).click();
    const tool = page.getByTestId("power-rename-content");
    await expect(tool.getByRole("tab", { name: "Rules" })).toBeVisible();
    await tool.getByLabel("Search", { exact: true }).fill("^.*");
    await tool.getByRole("tab", { name: "Live preview" }).click();
    await expect(tool.getByTestId("rename-preview-column")).toBeVisible();
    await expect(tool.getByTestId("rename-options-column")).not.toBeVisible();
    await tool.getByRole("tab", { name: "Rules" }).click();
    await expect(tool.getByLabel("Search", { exact: true })).toHaveValue("^.*");
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `/tmp/filebutler-mobile-${width}.png` });
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(tool.getByLabel("Search", { exact: true })).toHaveValue("^.*");
    await expect(tool.getByTestId("rename-preview-column")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("filebutler.workspace-mode"))).toBe("desktop");
  });
}

test("mobile preview opens in the foreground without selecting it from the window list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "Open File Manager", exact: true }).click();
  await page.getByRole("button", { name: "Test A /", exact: true }).click();
  await page.locator(".file-pane:visible").getByRole("button", { name: "preview.png", exact: true }).click();
  await expect(page.getByTestId("media-preview-content")).toBeVisible();
  await expect(page.locator(".file-pane:visible")).toHaveCount(0);
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  await expect(page.locator(".mobile-window-switcher")).toHaveCSS("transform", "none");
  const rows = page.locator(".mobile-window-row");
  await expect(rows).toHaveCount(2);
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(second!.y - first!.y - first!.height).toBeCloseTo(10, 0);
  const choice = await rows.first().locator(".mobile-window-choice").boundingBox();
  const close = await rows.first().getByRole("button", { name: /^Close window:/ }).boundingBox();
  expect(close!.width).toBe(44);
  expect(close!.x - choice!.x - choice!.width).toBeCloseTo(12, 0);
  await noHorizontalOverflow(page);
});

test("mobile jobs panel stays above its backdrop and can be closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.locator(".mobile-bottom-navigation button").last().click();
  const panel = page.getByRole("dialog", { name: "Jobs", exact: true });
  await expect(panel).toBeVisible();
  const panelLayer = await panel.evaluate(node => Number(getComputedStyle(node).zIndex));
  const overlayLayer = await page.locator('[data-slot="sheet-overlay"]').evaluate(node => Number(getComputedStyle(node).zIndex));
  expect(panelLayer).toBeGreaterThan(overlayLayer);
  const navigation = await page.locator(".mobile-bottom-navigation").boundingBox();
  const panelBounds = await panel.boundingBox();
  const overlayBounds = await page.locator('[data-slot="sheet-overlay"]').boundingBox();
  expect(panelBounds!.y + panelBounds!.height).toBeCloseTo(navigation!.y, 0);
  expect(overlayBounds!.y + overlayBounds!.height).toBeCloseTo(navigation!.y, 0);
  expect(await panel.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return node.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  })).toBe(true);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(panel).not.toBeVisible();
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0);
});

for (const compact of [false, true]) {
  test(`mobile bottom navigation switches between jobs, windows and files (${compact ? "compact" : "desktop"})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, compact);
    const navigation = page.locator(".mobile-bottom-navigation");
    await navigation.getByRole("button", { name: "File Manager", exact: true }).click();
    if (!compact) await page.getByRole("button", { name: "Test A /", exact: true }).click();
    const pane = page.locator(".file-pane:visible");
    await expect(pane.getByText("sample-0.txt", { exact: true })).toBeVisible();
    await navigation.locator("button").last().click();
    await expect(page.getByRole("dialog", { name: "Jobs", exact: true })).toBeVisible();
    await navigation.getByRole("button", { name: "Windows", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Jobs", exact: true })).not.toBeVisible();
    const switcher = page.locator(".mobile-window-switcher");
    await expect(switcher).toBeVisible();
    await expect(switcher).toHaveCSS("transform", "none");
    const bounds = await switcher.boundingBox();
    const navigationBounds = await navigation.boundingBox();
    expect(bounds!.y + bounds!.height).toBeCloseTo(navigationBounds!.y, 0);
    await navigation.getByRole("button", { name: "File Manager", exact: true }).click();
    await expect(switcher).not.toBeVisible();
    await expect(pane.getByText("sample-0.txt", { exact: true })).toBeVisible();
    await navigation.locator("button").last().click();
    await navigation.getByRole("button", { name: "File Manager", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Jobs", exact: true })).not.toBeVisible();
    await expect(pane.getByText("sample-0.txt", { exact: true })).toBeVisible();
  });
}

test("mobile window switcher fades in with a short upward motion and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await setup(page);
  await page.locator(".mobile-bottom-navigation button").last().click();
  const jobs = page.getByRole("dialog", { name: "Jobs", exact: true });
  const motion = await jobs.evaluate(node => {
    const style = getComputedStyle(node);
    return { duration: style.transitionDuration, easing: style.transitionTimingFunction };
  });
  await jobs.getByRole("button", { name: "Close", exact: true }).click();
  await expect(jobs).toHaveCount(0);
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  const switcher = page.locator(".mobile-window-switcher");
  await expect(switcher).toHaveCSS("animation-name", "mobile-window-slide-in");
  await expect(switcher).toHaveCSS("animation-duration", "0.2s");
  await expect(switcher).toHaveCSS("animation-duration", motion.duration);
  await expect(switcher).toHaveCSS("animation-timing-function", motion.easing);
  const frames = await switcher.evaluate(node => {
    const animation = node.getAnimations()[0];
    return (animation?.effect as KeyframeEffect | null)?.getKeyframes();
  });
  expect(frames?.[0]).toMatchObject({ transform: "translateY(40px)", opacity: "0" });
  expect(frames?.at(-1)).toMatchObject({ transform: "translateY(0px)", opacity: "1" });
  await expect(switcher).toHaveCSS("transform", "none");
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  await expect(switcher).toHaveAttribute("data-closing", "true");
  await expect(switcher).toHaveCSS("animation-name", "mobile-window-slide-out");
  await expect(switcher).toHaveCSS("animation-timing-function", motion.easing);
  await expect(switcher).toHaveAttribute("inert", "");
  await expect(switcher).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  await expect(switcher).toHaveCSS("animation-name", "none");
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  await expect(switcher).toHaveCount(0);
});

test("compact preference can open 115 on mobile and retain the account through rotation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true);
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  await page.getByRole("button", { name: "115网盘", exact: true }).click();
  await page.getByRole("button", { name: /Cloud tester/ }).click();
  await expect(page.getByText("Cloud folder", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1000, height: 700 });
  await expect(page.getByText("Cloud folder", { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText("Cloud folder", { exact: true })).toBeVisible();
  await noHorizontalOverflow(page);
  expect(await page.evaluate(() => localStorage.getItem("filebutler.workspace-mode"))).toBe("compact");
});

for (const width of [360, 390, 430]) {
  test(`mobile 115 long filenames do not widen the pane (${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await setup(page);
    const longName = "long-file-name-".repeat(30) + ".txt";
    await page.route("**/api/cloud115/browse", route => {
      const parentId = route.request().postDataJSON().parentId;
      const entries = parentId === "0"
        ? [{ id: "1", parentId: "0", name: "Cloud folder", size: 0, isDirectory: true }]
        : [{ id: "2", parentId: "1", name: longName, size: 1024, isDirectory: false }];
      return route.fulfill({ json: { data: { entries, total: entries.length, offset: 0 } } });
    });
    await page.getByRole("button", { name: "Windows", exact: true }).click();
    await page.getByRole("button", { name: "115网盘", exact: true }).click();
    await page.getByRole("button", { name: /Cloud tester/ }).click();
    await page.getByRole("button", { name: "Cloud folder", exact: true }).click();
    const pane = page.locator(".file-pane:visible");
    await expect(pane.getByText(longName, { exact: true })).toBeVisible();
    const bounds = await pane.boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    const more = await page.locator(".mobile-action-toolbar:visible").getByRole("button", { name: "More", exact: true }).boundingBox();
    expect(more!.x + more!.width).toBeLessThanOrEqual(width);
    await noHorizontalOverflow(page);
    await pane.getByRole("button", { name: "Select", exact: true }).click();
    await noHorizontalOverflow(page);
  });
}

test("compact mobile row menus snapshot the rename target without changing prior selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page, true);
  const pane = page.locator(".file-pane:visible");
  await expect(pane.getByText("sample-0.txt", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "More: sample-0.txt", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("sample-0.txt");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await pane.getByRole("button", { name: "More: sample-1.txt", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "PowerRename", exact: true }).click();
  const tool = page.getByTestId("power-rename-content");
  await tool.getByRole("tab", { name: "Live preview" }).click();
  await expect(tool.getByText("sample-1.txt", { exact: true })).toBeVisible();
  await expect(tool.getByText("sample-0.txt", { exact: true })).toHaveCount(0);
});

test("mobile SuperRename keeps group actions reachable and selections independent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "Open File Manager", exact: true }).click();
  await page.getByRole("button", { name: "Test A /", exact: true }).click();
  await page.locator(".mobile-action-toolbar").getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "SuperRename", exact: true }).click();
  const tree = page.getByTestId("super-rename-tree-scroll");
  await expect(tree.getByRole("button", { name: "Rename Album A now" })).toBeEnabled();
  await expect(tree.getByText("Album A/视频/V01.mp4", { exact: true })).toBeAttached();
  await tree.getByRole("checkbox", { name: "Select photo-0.jpg for SuperRename", exact: true }).first().uncheck();
  await expect(tree.getByRole("checkbox", { name: "Select photo-0.jpg for SuperRename", exact: true }).first()).toBeEnabled();
  await expect(tree.getByRole("checkbox", { name: "Select photo-0.jpg for SuperRename", exact: true }).last()).toBeChecked();
  await tree.evaluate(node => { node.scrollTop = 300; });
  const bounds = await tree.boundingBox();
  const header = await page.getByTestId("super-rename-group-Album A").boundingBox();
  expect(header!.y).toBeGreaterThanOrEqual(bounds!.y);
  expect(header!.y).toBeLessThan(bounds!.y + 5);
  const action = await tree.getByRole("button", { name: "Rename Album A now" }).boundingBox();
  expect(action!.x + action!.width).toBeLessThanOrEqual(390);
  expect(await tree.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: "/tmp/filebutler-mobile-superrename.png" });
  await page.goBack();
  await expect(tree).not.toBeVisible();
  await expect(page.locator(".file-pane:visible")).toBeVisible();
});

test("mobile menu back dismisses only the menu and window switching retains scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByRole("button", { name: "Open File Manager", exact: true }).click();
  await page.getByRole("button", { name: "Test A /", exact: true }).click();
  const list = page.locator(".file-list:visible");
  await list.evaluate(node => { node.scrollTop = 900; });
  const scroll = await list.evaluate(node => node.scrollTop);
  await page.locator(".mobile-action-toolbar").getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: "Windows", exact: true }).click();
  const switcher = page.locator(".mobile-window-switcher");
  await expect(switcher.getByRole("button", { name: "Cancel", exact: true })).toHaveCSS("border-top-width", "1px");
  for (const button of await switcher.locator(".mobile-window-choice").all()) {
    await expect(button).toHaveCSS("border-top-width", "1px");
  }
  await page.locator(".mobile-window-switcher").getByRole("button", { name: "Test A", exact: true }).click();
  expect(await list.evaluate(node => node.scrollTop)).toBe(scroll);
  await page.screenshot({ path: "/tmp/filebutler-mobile-files.png" });
});

for (const initialize of [false, true]) {
  test(`mobile authentication stays within viewport (${initialize ? "initialize" : "login"})`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.addInitScript(() => Object.defineProperty(navigator, "languages", { get: () => ["en-US"] }));
    await page.route("**/api/**", route => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      if (path === "/api/init/status") return route.fulfill({ json: { data: { needsInitialization: initialize } } });
      return route.fulfill({ status: 401, json: { error: { code: "unauthorized", message: "Login required" } } });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: initialize ? "Initialize administrator" : "Administrator login" })).toBeVisible();
    await page.getByLabel("Username", { exact: true }).fill("mobile-test");
    await noHorizontalOverflow(page);
    await page.setViewportSize({ width: 360, height: 400 });
    await page.getByLabel("Password", { exact: true }).fill("test-password");
    await noHorizontalOverflow(page);
  });
}
