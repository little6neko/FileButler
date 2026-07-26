# File Drag Activation And Feedback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict file dragging to the entry icon and visible name, restore marquee selection everywhere else in a row, and draw drag feedback above table dividers and the sticky header.

**Architecture:** Keep each `tr` registered as the full draggable and directory-droppable geometry, but move dnd-kit's activator reference and pointer listeners to a content-width icon-and-name wrapper. Let `FilePane` route every other non-interactive row gesture to its existing marquee and render pane feedback in a sibling foreground layer; expose active drag state from `DualPane` so CSS can switch cursors only after dnd-kit activation.

**Tech Stack:** React 19, TypeScript 6, `@dnd-kit/core`, Tailwind/shadcn-style local CSS, Vitest, Testing Library, Playwright.

---

## File Structure

- Modify `web/src/components/FileRow.tsx`: retain full-row drag/drop geometry while introducing the icon-and-name activator.
- Modify `web/src/components/FilePane.tsx`: allow marquee starts from non-activator row content and add a scroll-viewport feedback frame.
- Modify `web/src/components/DualPane.tsx`: expose whether a dnd-kit file drag is active on the workspace.
- Modify `web/src/styles.css`: size the activator to its visible content, remove idle hand cursors, and paint pane/row feedback in foreground layers.
- Modify `web/src/components/FilePane.test.tsx`: cover activator ownership, symlink boundaries, row-origin marquee selection, and pane feedback markup.
- Modify `web/src/styles.test.ts`: cover cursor policy and stacking requirements.
- Modify `web/e2e/drag-drop-context-menu.spec.ts`: drag from the new activator and verify cursor, marquee, and foreground feedback behavior in Chromium.

### Task 1: Specify The Drag Activator And Marquee Boundary

**Files:**
- Modify: `web/src/components/FilePane.test.tsx:366-419`
- Test: `web/src/components/FilePane.test.tsx`

- [ ] **Step 1: Extend the drag-source test with the exact activator boundary**

Replace `registers files as drag sources and directories as nested drop targets` with:

```tsx
it("registers full rows as drag sources but activates from only the icon and visible name", () => {
  renderPane({
    entries: [
      entry("file.txt"),
      entry("folder", "directory"),
      { ...entry("link", "symlink"), isSymlink: true, symlinkTarget: "target" },
    ],
  });

  const fileName = screen.getByText("file.txt");
  const fileRow = fileName.closest("tr");
  const fileHandle = fileName.closest<HTMLElement>("[data-file-drag-handle]");
  const directoryRow = screen.getByText("folder").closest("tr");
  const linkName = screen.getByText("link");
  const linkHandle = linkName.closest<HTMLElement>("[data-file-drag-handle]");
  const linkTarget = screen.getByText(/target/);
  if (!fileRow || !fileHandle || !directoryRow || !linkHandle) {
    throw new Error("expected drag source rows and handles");
  }

  expect(fileRow).toHaveAttribute("data-file-drag-source", "true");
  expect(fileRow).not.toHaveAttribute("data-drop-kind", "directory");
  expect(directoryRow).toHaveAttribute("data-file-drag-source", "true");
  expect(directoryRow).toHaveAttribute("data-drop-kind", "directory");
  expect(fileHandle).toContainElement(within(fileRow).getByTestId("file-icon-file"));
  expect(fileHandle).toContainElement(fileName);
  expect(linkHandle).toContainElement(linkName);
  expect(linkHandle).not.toContainElement(linkTarget);
});
```

- [ ] **Step 2: Replace the row-wide marquee exclusion test**

Replace `does not start marquee selection from a draggable row` with:

```tsx
it("does not start marquee selection from the file drag activator", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const row = screen.getByText("file.txt").closest("tr") as HTMLTableRowElement;
  const handle = screen.getByText("file.txt").closest("[data-file-drag-handle]");
  if (!handle) throw new Error("file drag handle was not rendered");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 96, width: 400, height: 96 });
  mockRect(row, { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });

  fireEvent.mouseDown(handle, { button: 0, clientX: 44, clientY: 44 });
  fireEvent.mouseMove(document, { clientX: 360, clientY: 60 });
  expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
  fireEvent.mouseUp(document);
  expect(onSelectPaths).not.toHaveBeenCalled();
});

it.each([
  { label: "unused name-cell space", cellIndex: 1 },
  { label: "type cell", cellIndex: 2 },
  { label: "size cell", cellIndex: 3 },
  { label: "modified-time cell", cellIndex: 4 },
])("starts marquee selection from $label", ({ cellIndex }) => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const row = screen.getByText("file.txt").closest("tr") as HTMLTableRowElement;
  const cells = within(row).getAllByRole("cell");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 96, width: 400, height: 96 });
  mockRect(row, { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });

  fireEvent.mouseDown(cells[cellIndex], { button: 0, clientX: 300, clientY: 40 });
  fireEvent.mouseMove(document, { clientX: 360, clientY: 60 });
  expect(container.querySelector(".drag-selection-box")).toBeInTheDocument();
  fireEvent.mouseUp(document, { clientX: 360, clientY: 60 });
  expect(onSelectPaths).toHaveBeenCalledWith(["file.txt"]);
});
```

Keep the existing checkbox exclusion and checkbox interaction tests unchanged.

- [ ] **Step 3: Run the focused tests and verify they fail for the current row-wide behavior**

Run from `web/`:

```bash
npm test -- --run src/components/FilePane.test.tsx
```

Expected: FAIL because no `[data-file-drag-handle]` exists and marquee selection is still blocked from every `[data-entry-path]` row.

- [ ] **Step 4: Commit the red component tests**

```bash
git add web/src/components/FilePane.test.tsx
git commit -m "test: cover precise file drag activation"
```

### Task 2: Move Drag Activation To The Icon And Name

**Files:**
- Modify: `web/src/components/FileRow.tsx:28-100`
- Modify: `web/src/components/FilePane.tsx:611-616`
- Modify: `web/src/styles.css:441-470`
- Test: `web/src/components/FilePane.test.tsx`

- [ ] **Step 1: Register an explicit dnd-kit activator**

In `FileRow`, use pointer-only activator semantics while retaining non-tabbable behavior:

```tsx
const drag = useDraggable({
  id: fileDragId(paneKey, entry.relativePath),
  data: dragData,
  attributes: { role: "button", tabIndex: -1 },
});
```

Keep `setNodeRef` on the `tr`, remove `{...drag.attributes}` and `{...drag.listeners}` from the `tr`, and replace the name cell with:

```tsx
<td>
  <span className="file-name-content">
    <span
      ref={drag.setActivatorNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      className="file-drag-handle"
      data-file-drag-handle="true"
    >
      <FileIcon name={entry.name} type={entry.type} />
      <span className="truncate font-medium text-slate-700">{entry.name}</span>
    </span>
    {entry.isSymlink && entry.symlinkTarget ? (
      <small className="truncate text-slate-400">{" -> "}{entry.symlinkTarget}</small>
    ) : null}
  </span>
</td>
```

Do not move the row's data attributes, double-click handler, draggable node reference, or directory droppable node reference.

- [ ] **Step 2: Allow marquee ownership outside the activator**

Change `isDragBlockedTarget` in `FilePane` to:

```tsx
function isDragBlockedTarget(target: EventTarget) {
  return target instanceof Element && Boolean(
    target.closest("button, input, select, textarea, a, thead, [data-file-drag-handle], [role='checkbox'], [role='separator']"),
  );
}
```

- [ ] **Step 3: Constrain the activator to visible content**

Add before the drag-state rules in `styles.css`:

```css
.file-name-content {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-drag-handle {
  width: fit-content;
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 6px;
}
```

- [ ] **Step 4: Run the focused component tests**

```bash
npm test -- --run src/components/FilePane.test.tsx
```

Expected: all `FilePane` tests pass, including checkbox selection and directory double-click navigation.

- [ ] **Step 5: Commit the activation implementation**

```bash
git add web/src/components/FileRow.tsx web/src/components/FilePane.tsx web/src/styles.css
git commit -m "fix: limit file dragging to entry names"
```

### Task 3: Specify Cursor And Foreground Feedback Behavior

**Files:**
- Modify: `web/src/components/FilePane.test.tsx:382-450`
- Modify: `web/src/styles.test.ts:53-57`
- Test: `web/src/components/FilePane.test.tsx`
- Test: `web/src/styles.test.ts`

- [ ] **Step 1: Import pane feedback types**

Add to `FilePane.test.tsx`:

```tsx
import { paneDropId, type FileDropFeedback } from "../fileDrag";
```

- [ ] **Step 2: Add pane feedback markup coverage**

Add after the drag-source registration test:

```tsx
it.each([
  { state: "valid", valid: true },
  { state: "invalid", valid: false },
])("renders $state pane feedback in a non-interactive foreground layer", ({ state, valid }) => {
  const feedback: FileDropFeedback = {
    target: {
      id: paneDropId("left"),
      kind: "current-directory",
      pane: "left",
      rootId: "data",
      path: ".",
      label: "Current directory",
    },
    operation: "move",
    valid,
    reason: valid ? undefined : "same-directory",
  };
  renderPane({ dropFeedback: feedback });

  const frame = screen.getByTestId("file-list-left").closest(".file-list-frame");
  const layer = frame?.querySelector(".file-list-drop-feedback");
  expect(frame).toHaveAttribute("data-drop-state", state);
  expect(layer).toHaveAttribute("data-drop-state", state);
  expect(layer).toHaveAttribute("aria-hidden", "true");
});

it("does not render pane feedback for a nonmatching target", () => {
  const feedback: FileDropFeedback = {
    target: {
      id: paneDropId("right"),
      kind: "current-directory",
      pane: "right",
      rootId: "data",
      path: ".",
      label: "Current directory",
    },
    operation: "move",
    valid: true,
  };
  renderPane({ dropFeedback: feedback });
  expect(document.querySelector(".file-list-drop-feedback")).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Add CSS contract tests**

Add to `styles.test.ts`:

```ts
it("keeps file drag cursors idle until dnd-kit activates a drag", () => {
  expect(rule(".file-drag-handle")).toContain("cursor: default;");
  expect(css).not.toContain("cursor: grab;");
  expect(rule('.workspace[data-file-drag-active="true"]')).toContain("cursor: grabbing;");
  expect(css).toContain('[data-drop-state="invalid"]');
  expect(css).toContain("cursor: not-allowed;");
});

it("draws pane and row drop feedback above sticky headers without intercepting input", () => {
  expect(rule(".file-list-frame")).toContain("position: relative;");
  expect(rule(".file-list-drop-feedback")).toContain("position: absolute;");
  expect(rule(".file-list-drop-feedback")).toContain("z-index: 6;");
  expect(rule(".file-list-drop-feedback")).toContain("pointer-events: none;");
  expect(rule('.file-table tbody tr[data-drop-state] > td::after')).toContain("z-index: 5;");
  expect(rule('.file-table tbody tr[data-drop-state] > td::after')).toContain("pointer-events: none;");
  expect(rule(".file-table thead th")).toContain("z-index: 3;");
});
```

- [ ] **Step 4: Run both focused suites and verify the new contracts fail**

```bash
npm test -- --run src/components/FilePane.test.tsx src/styles.test.ts
```

Expected: FAIL because the foreground pane layer, active workspace cursor state, and row pseudo-elements do not exist, and the old CSS still contains `cursor: grab`.

- [ ] **Step 5: Commit the red feedback tests**

```bash
git add web/src/components/FilePane.test.tsx web/src/styles.test.ts
git commit -m "test: cover foreground file drag feedback"
```

### Task 4: Implement Active Cursors And Foreground Feedback Layers

**Files:**
- Modify: `web/src/components/DualPane.tsx:311-316`
- Modify: `web/src/components/FilePane.tsx:88-105,321-400`
- Modify: `web/src/styles.css:227-240,441-493,569-572`
- Test: `web/src/components/FilePane.test.tsx`
- Test: `web/src/styles.test.ts`

- [ ] **Step 1: Expose active file-drag state on the workspace**

Add the active marker to the workspace section in `DualPane`:

```tsx
<section
  className="workspace"
  data-testid="workspace"
  data-active-pane={activePane}
  data-file-drag-active={dragSource ? "true" : "false"}
  style={workspaceStyle(leftPanePercent)}
>
```

`dragSource` is assigned only in `onDragStart`, after the existing 6-pixel activation threshold, and is already cleared by drop, cancellation, path/root navigation, and unmount paths.

- [ ] **Step 2: Derive matching pane feedback once**

Immediately after `paneDrop` setup in `FilePane`, add:

```tsx
const paneFeedback = dropFeedback?.target.id === paneTarget.id ? dropFeedback : null;
const paneDropState = paneFeedback ? (paneFeedback.valid ? "valid" : "invalid") : undefined;
```

- [ ] **Step 3: Separate the scroll viewport from its fixed feedback frame**

Insert a frame directly inside `PaneContextMenu` and move the current `.file-list` inside it:

```tsx
<PaneContextMenu actions={actions} label={labels.fileActions}>
  <div className="file-list-frame" data-drop-state={paneDropState}>
    <div
      className="file-list"
      data-testid={`file-list-${paneKey}`}
      ref={setFileListNode}
      onMouseDown={startDragSelection}
      onContextMenuCapture={(event) => {
        onActivate();
        const element = event.target instanceof Element ? event.target : null;
        const row = element?.closest<HTMLTableRowElement>("tbody tr[data-entry-path]");
        onContextTarget(row?.dataset.entryPath ?? null);
      }}
    >
```

Keep the existing loading, error, empty-directory, table, and `drag-selection-box` children in that `.file-list`. After its closing `</div>`, render the fixed layer and close the new frame:

```tsx
    </div>
    {paneFeedback ? (
      <div
        className="file-list-drop-feedback"
        data-drop-state={paneDropState}
        aria-hidden="true"
      />
    ) : null}
  </div>
</PaneContextMenu>
```

Delete the old `data-drop-state={...}` attribute from `.file-list`; `.file-list-frame` now owns visual state while `.file-list` remains the registered pane droppable and marquee coordinate space.

- [ ] **Step 4: Add the fixed pane feedback styles**

Add alongside `.file-list`:

```css
.file-list-frame {
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.file-list {
  height: 100%;
}

.file-list-drop-feedback {
  position: absolute;
  inset: 0;
  z-index: 6;
  pointer-events: none;
}

.file-list-drop-feedback[data-drop-state="valid"] {
  box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--primary) 70%, transparent);
}

.file-list-drop-feedback[data-drop-state="invalid"] {
  box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--destructive) 70%, transparent);
}
```

Retain `.file-list`'s existing `position`, `min-height`, `overflow`, and background declarations, then delete the old `.file-list[data-drop-state]` box-shadow rules.

- [ ] **Step 5: Replace row box shadows with foreground cell overlays**

Replace the current row feedback blocks with:

```css
.file-table tbody tr[data-drop-state="valid"] {
  --file-drop-color: var(--primary);
}

.file-table tbody tr[data-drop-state="invalid"] {
  --file-drop-color: var(--destructive);
}

.file-table tbody tr[data-drop-state="valid"] > td {
  background: color-mix(in oklab, var(--primary) 10%, var(--card));
}

.file-table tbody tr[data-drop-state="invalid"] > td {
  background: color-mix(in oklab, var(--destructive) 8%, var(--card));
}

.file-table tbody tr[data-drop-state] > td::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 5;
  box-sizing: border-box;
  pointer-events: none;
  border-top: 2px solid var(--file-drop-color);
  border-bottom: 2px solid var(--file-drop-color);
}

.file-table tbody tr[data-drop-state] > td:first-child::after {
  border-left: 2px solid var(--file-drop-color);
}

.file-table tbody tr[data-drop-state] > td:last-child::after {
  border-right: 2px solid var(--file-drop-color);
}
```

- [ ] **Step 6: Replace idle hand cursors with active-state cursors**

Delete both row-wide `cursor: grab`/`cursor: grabbing` blocks and the final `.directory-row` pointer-cursor block. Add `cursor: default` to the `.file-drag-handle` rule and add:

```css
.workspace[data-file-drag-active="true"] {
  cursor: grabbing;
}

.workspace[data-file-drag-active="true"] * {
  cursor: grabbing;
}

.workspace[data-file-drag-active="true"] [data-drop-state="invalid"],
.workspace[data-file-drag-active="true"] [data-drop-state="invalid"] * {
  cursor: not-allowed;
}
```

Retain the drag overlay's existing `grabbing` and invalid `not-allowed` rules because `DragOverlay` renders outside `.workspace`.

- [ ] **Step 7: Run the focused component and CSS tests**

```bash
npm test -- --run src/components/FilePane.test.tsx src/styles.test.ts
```

Expected: both suites pass. Pane feedback exists only for its matching target, no idle `grab` remains, and both foreground layers stack above the sticky header's `z-index: 3`.

- [ ] **Step 8: Commit the visual and cursor implementation**

```bash
git add web/src/components/DualPane.tsx web/src/components/FilePane.tsx web/src/styles.css
git commit -m "fix: raise file drag feedback above table chrome"
```

### Task 5: Exercise The Interaction In Chromium

**Files:**
- Modify: `web/e2e/drag-drop-context-menu.spec.ts:11-60,126-139`
- Test: `web/e2e/drag-drop-context-menu.spec.ts`

- [ ] **Step 1: Make browser drags begin from the dedicated activator**

Change `dragFileTo` to measure the source handle rather than the row:

```ts
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
```

- [ ] **Step 2: Add a helper that leaves a drag active for visual assertions**

Add below `dragFileTo`:

```ts
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
```

- [ ] **Step 3: Add browser-level cursor, feedback, and marquee coverage**

Add before the context-menu test:

```ts
test("limits dragging to names and keeps feedback above table chrome", async ({ page }) => {
  await installMockApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
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
  await page.mouse.up();
  await expect(workspace).toHaveAttribute("data-file-drag-active", "false");

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
```

- [ ] **Step 4: Build the frontend for the running Go test server**

From the repository root:

```bash
npm --prefix web run build
```

Expected: TypeScript and Vite complete successfully and update `web/dist`.

- [ ] **Step 5: Run the focused Playwright spec**

From `web/`:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8082 npx playwright test e2e/drag-drop-context-menu.spec.ts
```

Expected: all four tests pass. Existing same-pane/cross-pane previews remain unchanged, and the new test observes both foreground states and marquee selection.

- [ ] **Step 6: Inspect both browser screenshots**

Inspect `web/test-results/file-drop-feedback-invalid.png` and `web/test-results/file-drop-feedback-valid.png`. Confirm each frame is continuous on all four sides, appears above the sticky header and row dividers, does not cover unrelated pane chrome, and contains no overlapping controls or text.

- [ ] **Step 7: Commit the browser regression coverage**

```bash
git add web/e2e/drag-drop-context-menu.spec.ts
git commit -m "test: cover precise drag and marquee workflow"
```

Do not commit `web/test-results/`; screenshots are verification artifacts.

### Task 6: Full Verification And Manual Server Handoff

**Files:**
- Verify only; no planned source changes.

- [ ] **Step 1: Run all frontend unit and component tests**

From `web/`:

```bash
npm test -- --run
```

Expected: every Vitest test passes with no unhandled errors.

- [ ] **Step 2: Run ESLint**

```bash
npm run lint
```

Expected: exit code 0 with no lint errors.

- [ ] **Step 3: Run a production build**

```bash
npm run build
```

Expected: `tsc -b` and Vite both succeed.

- [ ] **Step 4: Run all Go regression tests**

From the repository root:

```bash
go test ./...
```

Expected: every Go package passes. No backend behavior changes are expected.

- [ ] **Step 5: Run the complete Playwright suite**

From `web/`:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8082 npx playwright test
```

Expected: all Playwright tests pass in Chromium.

- [ ] **Step 6: Restart the existing manual server on `0.0.0.0:8082`**

From the repository root:

```bash
server=/tmp/filebutler-manual-test.pBaMSk/filebutler
config=/tmp/filebutler-manual-test.pBaMSk/filebutler.yaml
log=/tmp/filebutler-manual-test.pBaMSk/server-8082.log
go build -o "${server}.next" ./cmd/filebutler
mv "${server}.next" "$server"
old_pid=$(pgrep -f "^${server} -config ${config}$" || true)
if [ -n "$old_pid" ]; then
  kill "$old_pid"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$old_pid" 2>/dev/null || break
    sleep 0.1
  done
fi
nohup "$server" -config "$config" >"$log" 2>&1 </dev/null &
```

Verify the replacement process:

```bash
curl -I http://127.0.0.1:8082/
tail -n 5 /tmp/filebutler-manual-test.pBaMSk/server-8082.log
```

Expected: HTTP responds successfully and the log reports `FileButler listening on 0.0.0.0:8082`.

- [ ] **Step 7: Confirm repository state**

```bash
git status --short --branch
git log -8 --oneline
```

Expected: the worktree is clean apart from ignored verification artifacts, `main` contains the planned test and implementation commits, and no push has occurred.
