import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type OpsPayload = {
  type: "move" | "copy";
  sourceRoot: string;
  sources: string[];
  destRoot: string;
  destPath: string;
};

type CheckboxMutationCounts = { name: number; type: number };
type CheckboxMutationProbe = {
  left: CheckboxMutationCounts;
  right: CheckboxMutationCounts;
  observers: MutationObserver[];
};

test("opens independent full-mode windows and pastes between their active locations", async ({ page }) => {
  const { dryRuns } = await installMockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const icon = page.getByRole("button", { name: "Open File Manager" });
  await expect(icon).toBeVisible();

  await icon.click();
  let windows = page.locator(".desktop-window");
  await expect(windows).toHaveCount(1);
  const firstWindow = windows.nth(0);
  await page.screenshot({ path: "test-results/full-mode-virtual-root.png", fullPage: true });
  const dataRoot = firstWindow.getByRole("button", { name: /Data/ });
  await dataRoot.click();
  await expect(firstWindow.getByRole("region", { name: "All locations" })).toBeVisible();
  await expect(entryRow(firstWindow, "source.txt")).not.toBeVisible();
  await dataRoot.dblclick();
  await expect(entryRow(firstWindow, "source.txt")).toBeVisible();
  await firstWindow.getByLabel("Select source.txt").click();
  await page.keyboard.press("Control+C");

  await icon.click();
  windows = page.locator(".desktop-window");
  await expect(windows).toHaveCount(2);
  const taskButtons = page.getByRole("navigation", { name: "System taskbar" }).locator(".taskbar-window-button");
  await expect(taskButtons).toHaveCount(2);
  const secondWindow = windows.nth(1);
  await secondWindow.getByRole("button", { name: /Archive/ }).dblclick();
  await expect(entryRow(secondWindow, "archive.txt")).toBeVisible();

  const titlebar = secondWindow.locator(".desktop-window-titlebar");
  const beforeMove = await secondWindow.boundingBox();
  const titlebarBox = await titlebar.boundingBox();
  if (!beforeMove || !titlebarBox) throw new Error("window geometry is unavailable");
  await dragLocatorBy(page, titlebar, 36, 24);
  const afterMove = await secondWindow.boundingBox();
  expect(afterMove?.x).toBeGreaterThan(beforeMove.x);
  expect(afterMove?.y).toBeGreaterThan(beforeMove.y);

  await page.keyboard.press("Control+V");
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "copy", sourceRoot: "data", sources: ["source.txt"], destRoot: "archive", destPath: ".",
  });
  await page.getByRole("dialog", { name: "copy preview" }).getByRole("button", { name: "Cancel" }).click();

  await dragLocatorBy(page, secondWindow.locator('[data-resize-direction="w"]'), 520, 0);
  await dragLocatorBy(page, titlebar, 360, 0);
  await taskButtons.nth(0).click();
  await dragLocatorBy(page, firstWindow.locator('[data-resize-direction="e"]'), -380, 0);
  const firstBox = await firstWindow.boundingBox();
  const secondBox = await secondWindow.boundingBox();
  if (!firstBox || !secondBox) throw new Error("resized window geometry is unavailable");
  expect(firstBox.x + firstBox.width).toBeLessThan(secondBox.x);
  await page.screenshot({ path: "test-results/full-mode-two-windows.png", fullPage: true });

  const crossWindowDropCount = dryRuns.length;
  await dragFileTo(page, entryRow(firstWindow, "source.txt"), entryRow(secondWindow, "archive-folder"));
  await expect.poll(() => dryRuns.length).toBeGreaterThan(crossWindowDropCount);
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "copy", sourceRoot: "data", sources: ["source.txt"], destRoot: "archive", destPath: "archive-folder",
  });
  await page.getByRole("dialog", { name: "copy preview" }).getByRole("button", { name: "Cancel" }).click();

  await secondWindow.getByRole("button", { name: "All locations" }).click();
  await expect(secondWindow.getByRole("region", { name: "All locations" })).toBeVisible();
  const rootCardDropCount = dryRuns.length;
  await dragFileTo(page, entryRow(firstWindow, "source.txt"), secondWindow.getByRole("button", { name: /Archive/ }));
  await expect.poll(() => dryRuns.length).toBeGreaterThan(rootCardDropCount);
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "copy", sourceRoot: "data", sources: ["source.txt"], destRoot: "archive", destPath: ".",
  });
  await page.getByRole("dialog", { name: "copy preview" }).getByRole("button", { name: "Cancel" }).click();

  await secondWindow.getByRole("button", { name: "Maximize window" }).click();
  await expect(secondWindow).toHaveAttribute("data-window-status", "maximized");
  await secondWindow.getByRole("button", { name: "Restore window" }).click();
  await secondWindow.getByRole("button", { name: "Minimize window" }).click();
  await expect(windows).toHaveCount(1);
  const secondTaskButton = taskButtons.nth(1);
  await expect(secondTaskButton).toHaveAttribute("data-window-status", "minimized");
  await secondTaskButton.click();
  await expect(windows).toHaveCount(2);

  await page.getByRole("button", { name: "Switch to compact mode" }).click();
  await expect(page.getByTestId("workspace")).toBeVisible();
  await page.getByRole("button", { name: "Switch to full mode" }).click();
  await expect(page.locator(".desktop-window")).toHaveCount(2);

  await page.reload();
  await expect(page.getByTestId("desktop-workspace")).toBeVisible();
  await expect(page.locator(".desktop-window")).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to compact mode" }).click();
  await expect(page.getByTestId("workspace")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("workspace")).toBeVisible();
  await expect(page.locator(".desktop-window")).toHaveCount(0);
});

test("keeps a context-opened directory window active and routes keyboard paste to it", async ({ page }) => {
  const { dryRuns } = await installMockApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Open File Manager" }).click();
  const windows = page.locator(".desktop-window");
  await expect(windows).toHaveCount(1);
  const sourceWindow = windows.nth(0);
  await sourceWindow.getByRole("button", { name: /Data/ }).dblclick();
  await expect(entryRow(sourceWindow, "folder")).toBeVisible();

  const toolbarActions = sourceWindow.getByRole("navigation", { name: "File actions" }).locator("[data-action-id]");
  await expect(toolbarActions).toHaveCount(4);
  expect(await toolbarActions.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-action-id")))).toEqual([
    "rename", "powerRename", "mkdir", "delete",
  ]);
  await expect(toolbarActions.first()).toHaveAttribute("data-variant", "outline");

  await sourceWindow.getByLabel("Select source.txt").click();
  await page.keyboard.press("Control+C");
  await entryRow(sourceWindow, "folder").click({ button: "right" });
  const fullMenu = page.getByRole("menu", { name: "File actions" });
  const fullMenuActions = fullMenu.locator("[data-action-id]");
  await expect(fullMenuActions).toHaveCount(8);
  expect(await fullMenuActions.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-action-id")))).toEqual([
    "openInNewWindow", "clipboardCopy", "clipboardCut", "clipboardPaste",
    "rename", "powerRename", "mkdir", "delete",
  ]);
  await fullMenu.locator('[data-action-id="openInNewWindow"]').click();

  await expect(windows).toHaveCount(2);
  const directoryWindow = windows.nth(1);
  await expect(sourceWindow).toHaveAttribute("data-active", "false");
  await expect(directoryWindow).toHaveAttribute("data-active", "true");
  await expect(page.locator(".taskbar-window-button").nth(1)).toHaveAttribute("aria-current", "page");
  const [sourceZ, directoryZ] = await Promise.all([
    sourceWindow.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
    directoryWindow.evaluate((element) => Number.parseInt(getComputedStyle(element).zIndex, 10)),
  ]);
  expect(directoryZ).toBeGreaterThan(sourceZ);

  await page.keyboard.press("Control+V");
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "copy", sourceRoot: "data", sources: ["source.txt"], destRoot: "data", destPath: "folder",
  });
  await page.getByRole("dialog", { name: "copy preview" }).getByRole("button", { name: "Cancel" }).click();
});

test("positions and toggles the jobs sheet and dismisses it for taskbar context changes", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const icon = page.getByRole("button", { name: "Open File Manager" });
  await icon.click();
  await icon.click();
  const jobsButton = page.locator('.system-taskbar button[aria-label="Jobs"]');
  const jobsSheet = page.getByRole("dialog", { name: "Jobs" });

  await expect(jobsButton).toHaveAttribute("aria-expanded", "false");
  await jobsButton.click();
  await expect(jobsSheet).toBeVisible();
  await expect(jobsButton).toHaveAttribute("aria-expanded", "true");
  const [taskbarBox, sheetBox] = await Promise.all([
    page.locator(".system-taskbar").boundingBox(),
    jobsSheet.boundingBox(),
  ]);
  if (!taskbarBox || !sheetBox) throw new Error("jobs sheet geometry is unavailable");
  expect(sheetBox.y).toBeGreaterThanOrEqual(taskbarBox.y + taskbarBox.height);
  expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);

  await jobsButton.click();
  await expect(jobsSheet).not.toBeVisible();
  await expect(jobsButton).toHaveAttribute("aria-expanded", "false");

  await jobsButton.click();
  await expect(jobsSheet).toBeVisible();
  await page.locator(".taskbar-window-button").nth(0).click();
  await expect(jobsSheet).not.toBeVisible();

  await jobsButton.click();
  await expect(jobsSheet).toBeVisible();
  await page.locator('.taskbar-mode-button[aria-label="Switch to compact mode"]').click();
  await expect(jobsSheet).not.toBeVisible();
  await expect(page.getByTestId("workspace")).toBeVisible();
});

test("cancels from the overlaid task X and keeps terminal history only until refresh", async ({ page }) => {
  await installMockJobEventSource(page);
  const { canceledJobs } = await installMockApi(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Open File Manager" })).toBeVisible();
  await emitMockJobEvent(page, "jobs.snapshot", {
    runtimeId: "e2e-runtime",
    cursor: 2,
    reset: false,
    jobs: [
      { ...makeE2EJob({ id: "job-copy", type: "copy", createdAtUnix: 2, eventVersion: 1 }), items: [] },
      { ...makeE2EJob({ id: "job-move", type: "move", createdAtUnix: 1, eventVersion: 2 }), items: [] },
    ],
  });

  await page.getByRole("button", { name: "Jobs" }).click();
  const copyRow = page.getByRole("button", { name: /copy.*Running/i });
  const moveRow = page.getByRole("button", { name: /move.*Running/i });
  const cancelMove = page.getByRole("button", { name: "Cancel move job" });
  await expect(copyRow).toHaveAttribute("aria-pressed", "true");
  await expect(moveRow).toHaveAttribute("aria-pressed", "false");
  expect(await cancelMove.evaluate((button) => button.parentElement?.classList.contains("job-row-shell"))).toBe(true);
  expect(await cancelMove.evaluate((button) => button.parentElement?.querySelector(".job-row-main") !== null)).toBe(true);
  const activePadding = await moveRow.evaluate((row) => getComputedStyle(row).paddingRight);
  const restingBackground = await cancelMove.evaluate((button) => getComputedStyle(button).backgroundColor);
  await cancelMove.hover();
  const hoverBackground = await cancelMove.evaluate((button) => getComputedStyle(button).backgroundColor);
  expect(hoverBackground).not.toBe(restingBackground);

  await cancelMove.click();

  await expect.poll(() => canceledJobs).toContain("job-move");
  await expect(cancelMove).toBeDisabled();
  await expect(page.getByRole("button", { name: /move.*Canceling/i })).toHaveAttribute("aria-pressed", "false");
  await expect(copyRow).toHaveAttribute("aria-pressed", "true");

  await emitMockJobEvent(page, "job.changed", {
    runtimeId: "e2e-runtime",
    cursor: 3,
    job: makeE2EJob({ id: "job-move", type: "move", status: "canceled", createdAtUnix: 1, eventVersion: 3 }),
    items: [],
  });
  const canceledRow = page.getByRole("button", { name: /move.*Canceled/i });
  await expect(canceledRow).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel move job" })).toHaveCount(0);
  const terminalPadding = await canceledRow.evaluate((row) => ({
    left: getComputedStyle(row).paddingLeft,
    right: getComputedStyle(row).paddingRight,
  }));
  expect(terminalPadding.right).toBe(terminalPadding.left);
  expect(parseFloat(terminalPadding.right)).toBeLessThan(parseFloat(activePadding));

  await page.reload();
  await expect(page.getByRole("button", { name: "Open File Manager" })).toBeVisible();
  await emitMockJobEvent(page, "jobs.snapshot", {
    runtimeId: "e2e-runtime-next-page",
    cursor: 0,
    reset: false,
    jobs: [],
  });
  await page.getByRole("button", { name: "Jobs" }).click();
  await expect(page.getByText("No background jobs yet")).toBeVisible();
});

test("previews same-pane and cross-pane drops with Windows-style defaults", async ({ page }) => {
  const { dryRuns } = await installMockApi(page);
  await openCompactWorkspace(page);
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

  await left.getByLabel("Select peer.txt").click();
  await expect(left.getByLabel("Select source.txt")).toBeChecked();
  await expect(left.getByLabel("Select peer.txt")).toBeChecked();
  const sameRootDryRunCount = dryRuns.length;
  await dragFileTo(page, entryRow(left, "source.txt"), entryRow(right, "folder"));
  await expect.poll(() => dryRuns.length).toBeGreaterThan(sameRootDryRunCount);
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "move", sourceRoot: "data", sources: ["peer.txt", "source.txt"], destRoot: "data", destPath: "folder",
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

test("limits dragging to names and keeps feedback above table chrome", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCompactWorkspace(page);
  const workspace = page.getByTestId("workspace");
  const left = page.getByRole("region", { name: "Left pane" });
  const right = page.getByRole("region", { name: "Right pane" });
  const source = entryRow(left, "source.txt");
  const handle = source.locator('[data-file-drag-handle="true"]');
  const nameCell = source.getByRole("cell").nth(1);
  await expect(source).toBeVisible();

  await handle.hover();
  expect(await handle.evaluate((element) => getComputedStyle(element).cursor)).toBe("default");
  const handleBox = await handle.boundingBox();
  const nameCellBox = await nameCell.boundingBox();
  if (!handleBox || !nameCellBox) throw new Error("name geometry is unavailable");
  expect(handleBox.x + handleBox.width).toBeLessThan(nameCellBox.x + nameCellBox.width);

  await holdFileDragTo(page, source, entryRow(left, "peer.txt"));
  await expect(workspace).toHaveAttribute("data-file-drag-active", "true");
  const invalidLayer = left.locator('.file-list-drop-feedback[data-drop-state="invalid"]');
  await expect(invalidLayer).toBeVisible();
  expect(await entryRow(left, "peer.txt").evaluate((element) => getComputedStyle(element).cursor)).toBe("not-allowed");
  const invalidZ = await invalidLayer.evaluate((element) => Number(getComputedStyle(element).zIndex));
  const headerZ = await left.locator("thead th").first().evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(invalidZ).toBeGreaterThan(headerZ);
  await page.screenshot({ path: "test-results/file-drop-feedback-invalid.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(workspace).toHaveAttribute("data-file-drag-active", "false");
  await page.mouse.up();
  expect(await handle.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");

  await right.getByRole("combobox", { name: "Right pane root" }).selectOption("archive");
  await expect(entryRow(right, "archive.txt")).toBeVisible();
  await holdFileDragTo(page, source, entryRow(right, "archive.txt"));
  const validLayer = right.locator('.file-list-drop-feedback[data-drop-state="valid"]');
  await expect(validLayer).toBeVisible();
  expect(await entryRow(right, "archive.txt").evaluate((element) => getComputedStyle(element).cursor)).toBe("grabbing");
  await page.screenshot({ path: "test-results/file-drop-feedback-valid.png", fullPage: true });
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "copy preview" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const typeCell = source.getByRole("cell").nth(2);
  const peer = entryRow(left, "peer.txt");
  const typeBox = await typeCell.boundingBox();
  const peerBox = await peer.boundingBox();
  if (!typeBox || !peerBox) throw new Error("marquee geometry is unavailable");
  await page.mouse.move(typeBox.x + typeBox.width / 2, typeBox.y + typeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(typeBox.x + typeBox.width / 2 + 8, peerBox.y + peerBox.height / 2, { steps: 8 });
  await expect(left.locator(".drag-selection-box")).toBeVisible();
  await expect(workspace).toHaveAttribute("data-file-drag-active", "false");
  await page.mouse.up();
  await expect(left.getByLabel("Select source.txt")).toBeChecked();
  await expect(left.getByLabel("Select peer.txt")).toBeChecked();
  await expect(page.getByRole("dialog", { name: /preview/ })).toHaveCount(0);
});

test("supports desktop row selection and auto-scrolls a long marquee", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openCompactWorkspace(page);
  const left = page.getByRole("region", { name: "Left pane" });
  await left.getByRole("combobox", { name: "Left pane root" }).selectOption("long");
  await expect(entryRow(left, "item-01.txt")).toBeVisible();

  await entryRow(left, "item-02.txt").getByRole("cell").nth(2).click();
  await expect(left.getByLabel("Select item-02.txt")).toBeChecked();
  await expect(left.getByLabel("Select item-01.txt")).not.toBeChecked();

  await entryRow(left, "item-04.txt").getByRole("cell").nth(3).click({ modifiers: ["Control"] });
  await expect(left.getByLabel("Select item-02.txt")).toBeChecked();
  await expect(left.getByLabel("Select item-04.txt")).toBeChecked();

  await left.getByRole("combobox", { name: "Left pane root" }).selectOption("data");
  await expect(entryRow(left, "source.txt")).toBeVisible();
  await left.getByRole("combobox", { name: "Left pane root" }).selectOption("long");
  await expect(entryRow(left, "item-01.txt")).toBeVisible();

  await page.keyboard.down("Shift");
  await entryRow(left, "item-03.txt").getByRole("cell").nth(2).click();
  await entryRow(left, "item-06.txt").getByRole("cell").nth(2).click();
  await page.keyboard.up("Shift");
  await expect(left.getByLabel("Select item-02.txt")).not.toBeChecked();
  for (const index of [3, 4, 5, 6]) {
    await expect(left.getByLabel(`Select item-${String(index).padStart(2, "0")}.txt`)).toBeChecked();
  }

  await entryRow(left, "item-09.txt").getByRole("cell").nth(4).click();
  await expect(left.getByLabel("Select item-09.txt")).toBeChecked();
  await expect(left.getByLabel("Select item-03.txt")).not.toBeChecked();
  await expect(left.getByLabel("Select item-06.txt")).not.toBeChecked();

  const fileList = left.getByTestId("file-list-left");
  await fileList.evaluate((element) => {
    element.scrollTop = 0;
  });
  const startCell = entryRow(left, "item-01.txt").getByRole("cell").nth(2);
  const [startBox, listBox] = await Promise.all([startCell.boundingBox(), fileList.boundingBox()]);
  if (!startBox || !listBox) throw new Error("long-list marquee geometry is unavailable");
  const rows = left.locator("tbody tr");
  const rowCount = await rows.count();
  await rows.evaluateAll((elements) => {
    const state = window as Window & { __marqueeRowRectReads: number };
    state.__marqueeRowRectReads = 0;
    elements.forEach((element) => {
      const original = element.getBoundingClientRect.bind(element);
      element.getBoundingClientRect = () => {
        state.__marqueeRowRectReads += 1;
        return original();
      };
    });
  });
  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const edgeX = Math.min(listBox.x + listBox.width - 4, startX + 12);
  const edgeY = listBox.y + listBox.height - 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(edgeX, edgeY, { steps: 8 });
  await expect.poll(() => fileList.evaluate((element) => element.scrollTop)).toBeGreaterThan(80);
  await expect(left.getByLabel("Select item-24.txt")).toBeChecked();
  await expect.poll(() => page.evaluate(
    () => (window as Window & { __marqueeRowRectReads: number }).__marqueeRowRectReads,
  )).toBe(rowCount);
  await page.mouse.up();
});

test("updates only the changed row checkbox when selection changes", async ({ page }) => {
  await installMockApi(page);
  await openCompactWorkspace(page);
  const left = page.getByRole("region", { name: "Left pane" });
  const right = page.getByRole("region", { name: "Right pane" });
  await left.getByRole("combobox", { name: "Left pane root" }).selectOption("long");
  await expect(entryRow(left, "item-01.txt")).toBeVisible();
  await expect(entryRow(right, "source.txt")).toBeVisible();

  await page.evaluate(() => {
    const probe: CheckboxMutationProbe = {
      left: { name: 0, type: 0 },
      right: { name: 0, type: 0 },
      observers: [],
    };
    for (const pane of ["left", "right"] as const) {
      const root = document.querySelector(`[data-testid="file-list-${pane}"]`);
      if (!root) throw new Error(`missing ${pane} file list`);
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName === "name" || record.attributeName === "type") {
            probe[pane][record.attributeName] += 1;
          }
        }
      });
      observer.observe(root, { attributes: true, attributeFilter: ["name", "type"], subtree: true });
      probe.observers.push(observer);
    }
    (window as Window & { __checkboxMutationProbe?: CheckboxMutationProbe }).__checkboxMutationProbe = probe;
  });

  await entryRow(left, "item-01.txt").getByRole("cell").nth(2).click();
  await expect(left.getByLabel("Select item-01.txt")).toBeChecked();
  const mutations = await page.evaluate(() => {
    const probe = (window as Window & { __checkboxMutationProbe?: CheckboxMutationProbe }).__checkboxMutationProbe;
    if (!probe) throw new Error("checkbox mutation probe is unavailable");
    probe.observers.forEach((observer) => observer.disconnect());
    return { left: probe.left, right: probe.right };
  });

  expect(mutations.left.name).toBeLessThanOrEqual(2);
  expect(mutations.left.type).toBeLessThanOrEqual(1);
  expect(mutations.right).toEqual({ name: 0, type: 0 });
});

test("uses row and whitespace context selection while keeping all actions visible", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCompactWorkspace(page);
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
  expect(await menu.locator("[data-action-id]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-action-id")))).toEqual([
    "copy", "move", "symlink", "hardlink", "rename", "powerRename", "mkdir", "delete",
  ]);
  await expect(menu.locator('[data-action-id="mkdir"]')).not.toHaveAttribute("aria-disabled", "true");
  for (const id of ["copy", "move", "symlink", "hardlink", "rename", "powerRename", "delete"]) {
    await expect(menu.locator(`[data-action-id="${id}"]`)).toHaveAttribute("aria-disabled", "true");
  }
  for (const id of ["openInNewWindow", "clipboardCopy", "clipboardCut", "clipboardPaste"]) {
    await expect(menu.locator(`[data-action-id="${id}"]`)).toHaveCount(0);
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

test("points compact move actions toward their destination pane", async ({ page }) => {
  await installMockApi(page);
  await openCompactWorkspace(page);
  const left = page.getByRole("region", { name: "Left pane" });
  const right = page.getByRole("region", { name: "Right pane" });
  const toolbarMove = page.getByRole("navigation", { name: "File actions" }).locator('[data-action-id="move"]');

  await expect(toolbarMove.locator(".lucide-move-right")).toHaveCount(1);
  await openBlankContextMenu(left.getByTestId("file-list-left"));
  let menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu.locator('[data-action-id="move"] .lucide-move-right')).toHaveCount(1);
  await page.keyboard.press("Escape");

  await openBlankContextMenu(right.getByTestId("file-list-right"));
  menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu.locator('[data-action-id="move"] .lucide-move-left')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(toolbarMove.locator(".lucide-move-left")).toHaveCount(1);
});

test("confirms a ready operation with Enter without opening Jobs", async ({ page }) => {
  const { createdJobs } = await installMockApi(page);
  await openCompactWorkspace(page);
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
  const sourceBox = await source.locator('[data-file-drag-handle="true"]').boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("drag source handle or target has no bounding box");
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

async function holdFileDragTo(page: Page, source: Locator, target: Locator) {
  const sourceBox = await source.locator('[data-file-drag-handle="true"]').boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("drag source handle or target has no bounding box");
  const sourceX = sourceBox.x + sourceBox.width / 2;
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetX = targetBox.x + targetBox.width / 2;
  const targetY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(sourceX, sourceY);
  await page.mouse.down();
  await page.mouse.move(sourceX + 8, sourceY, { steps: 2 });
  await page.mouse.move(targetX, targetY, { steps: 8 });
}

async function dragLocatorBy(page: Page, locator: Locator, deltaX: number, deltaY: number) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("drag locator has no bounding box");
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + deltaX, startY + deltaY, { steps: 8 });
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

async function openCompactWorkspace(page: Page) {
  await page.goto("/");
  const switchButton = page.getByRole("button", { name: "Switch to compact mode" });
  await expect(switchButton.or(page.getByTestId("workspace"))).toBeVisible();
  if (await switchButton.isVisible()) await switchButton.click();
  await expect(page.getByTestId("workspace")).toBeVisible();
}

async function installMockApi(page: Page) {
  const dryRuns: OpsPayload[] = [];
  const createdJobs: OpsPayload[] = [];
  const canceledJobs: string[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["en-US"] });
  });
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.pathname === "/api/init/status") return respond(route, { needsInitialization: false });
    if (url.pathname === "/api/auth/me") return respond(route, { id: 1, username: "admin" });
    if (url.pathname === "/api/roots") {
      return respond(route, [
        { id: "data", name: "Data" },
        { id: "archive", name: "Archive" },
        { id: "long", name: "Long list" },
      ]);
    }
    if (url.pathname === "/api/browse") {
      const rootID = url.searchParams.get("rootId");
      return respond(route, rootID === "archive" ? archiveEntries : rootID === "long" ? longEntries : dataEntries);
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
    const cancelMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method() === "POST") {
      canceledJobs.push(decodeURIComponent(cancelMatch[1]));
      return respond(route, { id: canceledJobs.at(-1) });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_mocked", message: url.pathname } }),
    });
  });
  return { dryRuns, createdJobs, canceledJobs };
}

async function installMockJobEventSource(page: Page) {
  await page.addInitScript(() => {
    type Listener = (event: MessageEvent<string>) => void;
    type JobEventWindow = Window & {
      __fileButlerJobSource?: { emit(type: string, payload: unknown): void };
    };
    class MockEventSource {
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      listeners = new Map<string, Set<Listener>>();

      constructor(url: string) {
        void url;
        (window as JobEventWindow).__fileButlerJobSource = this;
        queueMicrotask(() => this.onopen?.());
      }

      addEventListener(type: string, listener: Listener) {
        const listeners = this.listeners.get(type) ?? new Set<Listener>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      close() {}

      emit(type: string, payload: unknown) {
        const event = new MessageEvent(type, { data: JSON.stringify(payload) });
        for (const listener of this.listeners.get(type) ?? []) listener(event);
      }
    }
    Object.defineProperty(window, "EventSource", { configurable: true, value: MockEventSource });
  });
}

async function emitMockJobEvent(page: Page, type: string, payload: unknown) {
  await page.evaluate(({ eventType, eventPayload }) => {
    const source = (window as Window & {
      __fileButlerJobSource?: { emit(type: string, payload: unknown): void };
    }).__fileButlerJobSource;
    if (!source) throw new Error("mock job EventSource is unavailable");
    source.emit(eventType, eventPayload);
  }, { eventType: type, eventPayload: payload });
}

function makeE2EJob(overrides: Record<string, unknown>) {
  return {
    id: "job-1",
    type: "copy",
    status: "running",
    actorId: 1,
    sourceRootId: "data",
    progressTotal: 4,
    progressDone: 1,
    cancelRequested: false,
    errorMessage: "",
    createdAtUnix: 1,
    updatedAtUnix: 1,
    eventVersion: 1,
    ...overrides,
  };
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

const longEntries = Array.from({ length: 260 }, (_, index) => {
  const name = `item-${String(index + 1).padStart(2, "0")}.txt`;
  return { name, relativePath: name, type: "file", size: index + 1, mode: "", modifiedUnix: index, isSymlink: false };
});
