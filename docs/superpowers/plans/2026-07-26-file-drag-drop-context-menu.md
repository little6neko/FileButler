# File Drag, Drop, And Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preview-confirmed same-pane and cross-pane file dragging plus a toolbar-equivalent context menu, with Move/Copy inference and recursive-directory safety.

**Architecture:** Keep `DualPane` as the cross-pane coordinator, move deterministic drag/drop rules into a pure TypeScript module, and let `FilePane`/`FileRow` expose draggable and droppable DOM surfaces through `@dnd-kit/core`. Build toolbar and context-menu UI from one action descriptor list, extend `OperationPreview` only for drag-selectable Move/Copy requests, and make the Go planner reject directory destinations inside their source.

**Tech Stack:** Go 1.24, React 19, TypeScript 6, Vite 8, `@dnd-kit/core`, Base UI ContextMenu, local shadcn/ui components, Lucide React, Vitest, Testing Library, and Playwright.

---

## File Structure

Create these focused units:

- `web/src/fileDrag.ts`: framework-light drag payload, drop target, operation inference, validation, and request construction.
- `web/src/fileDrag.test.ts`: deterministic tests for selection ordering, root comparison, target resolution, and invalid destinations.
- `web/src/components/fileActions.ts`: the single ordered action descriptor list consumed by toolbar and context menu.
- `web/src/components/fileActions.test.ts`: action order, labels, callbacks, and enabled-state coverage.
- `web/src/components/ui/context-menu.tsx`: Base UI ContextMenu wrappers using the same data slots as the existing menu styling.
- `web/src/components/PaneContextMenu.tsx`: FileButler action-menu renderer.
- `web/src/components/PaneContextMenu.test.tsx`: complete-menu and disabled-item coverage.
- `web/src/components/FileRow.tsx`: one draggable table row and optional directory drop target.
- `web/src/components/FileDragOverlay.tsx`: compact, layout-independent drag overlay and localized announcements.
- `web/src/components/FileDragOverlay.test.tsx`: overlay name, operation, destination, and count coverage.
- `web/e2e/drag-drop-context-menu.spec.ts`: route-mocked browser tests that never mutate real files.

Modify existing ownership boundaries:

- `internal/ops/planner.go` and `internal/ops/planner_test.go`: reject Move/Copy destinations inside a source directory.
- `web/package.json` and `web/package-lock.json`: add `@dnd-kit/core`.
- `web/src/components/DualPane.tsx`: own `DndContext`, active drag state, collision resolution, pane-specific actions, and drag preview creation.
- `web/src/components/FilePane.tsx`: expose pane/current-directory drop data, context-target intent, and blank-only marquee selection.
- `web/src/components/ActionToolbar.tsx`: render shared action descriptors as buttons.
- `web/src/components/OperationPreview.tsx`: optionally expose Move/Copy as a segmented control and rerun dry-run safely.
- `web/src/components/*.test.tsx`: focused regression and integration coverage beside each changed component.
- `web/src/i18n.ts` and `web/src/i18n.test.ts`: add English and Simplified Chinese drag/menu/announcement labels.
- `web/src/styles.css`: add compact drop feedback, drag overlay, segmented control, and context-menu grouping rules.
- `web/playwright.config.ts`: allow the focused mocked suite to target an explicitly selected local port.
- `web/.gitignore`: exclude local Playwright screenshots and reports.

Do not change browse or operation API payload shapes. Dragging must construct the existing `OpsRequest`, and context commands must call the same handlers as the toolbar.

### Task 1: Reject Recursive Directory Transfers In The Planner

**Files:**
- Modify: `internal/ops/planner_test.go`
- Modify: `internal/ops/planner.go:63-87`
- Test: `internal/ops/planner_test.go`

- [ ] **Step 1: Add failing planner tests for same-root and overlapping-root destinations**

Add `os` to the test imports and append:

```go
func TestPlanTransferRejectsDestinationInsideSource(t *testing.T) {
	for _, operation := range []OperationType{OpMove, OpCopy} {
		for _, destination := range []string{"folder", "folder/child"} {
			t.Run(string(operation)+"/"+destination, func(t *testing.T) {
				root := t.TempDir()
				if err := os.MkdirAll(filepath.Join(root, "folder", "child"), 0o755); err != nil {
					t.Fatal(err)
				}
				planner := Planner{Resolver: roots.NewResolver([]roots.Root{{ID: "root", Name: "Root", Path: root}})}

				plan, err := planner.Plan(context.Background(), Request{
					Type: operation, SourceRoot: "root", Sources: []string{"folder"},
					DestRoot: "root", DestPath: destination,
				})
				if err != nil {
					t.Fatal(err)
				}
				if !plan.HasConflict || plan.Items[0].ErrorCode != "destination_inside_source" {
					t.Fatalf("plan = %+v", plan)
				}
			})
		}
	}
}

func TestPlanCopyRejectsOverlappingRootInsideSource(t *testing.T) {
	root := t.TempDir()
	destinationRoot := filepath.Join(root, "folder", "mounted-root")
	if err := os.MkdirAll(destinationRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	planner := Planner{Resolver: roots.NewResolver([]roots.Root{
		{ID: "source", Name: "Source", Path: root},
		{ID: "destination", Name: "Destination", Path: destinationRoot},
	})}

	plan, err := planner.Plan(context.Background(), Request{
		Type: OpCopy, SourceRoot: "source", Sources: []string{"folder"},
		DestRoot: "destination", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "destination_inside_source" {
		t.Fatalf("plan = %+v", plan)
	}
}
```

- [ ] **Step 2: Run the focused planner tests and verify the unsafe plans are currently accepted**

Run from the repository root:

```bash
go test ./internal/ops -run 'TestPlan(TransferRejectsDestinationInsideSource|CopyRejectsOverlappingRootInsideSource)$' -v
```

Expected: FAIL because the planner currently marks the nested destination ready instead of returning `destination_inside_source`.

- [ ] **Step 3: Commit the red planner tests**

```bash
git add internal/ops/planner_test.go
git commit -m "test: cover recursive directory transfers"
```

- [ ] **Step 4: Add a segment-safe resolved-path guard to the planner**

Add `strings` to `internal/ops/planner.go` imports. Replace the destination resolution branch inside `case OpMove, OpCopy, OpSymlink, OpHardlink` with:

```go
dest, err := p.Resolver.ResolveForWrite(req.DestRoot, destPath)
if err != nil {
	item.Conflict = true
	item.ErrorCode = errorCode(err)
	item.ErrorText = err.Error()
} else if (req.Type == OpMove || req.Type == OpCopy) && info.IsDir() && pathInside(source.Abs, dest.Abs) {
	item.Conflict = true
	item.ErrorCode = "destination_inside_source"
	item.ErrorText = "destination cannot be inside the source directory"
} else if _, err := os.Lstat(dest.Abs); err == nil {
	item.Conflict = true
	item.ErrorCode = "target_exists"
	item.ErrorText = "destination already exists"
} else if !os.IsNotExist(err) {
	item.Conflict = true
	item.ErrorCode = "operation_failed"
	item.ErrorText = err.Error()
}
```

Add this helper beside `defaultPath`:

```go
func pathInside(parent, candidate string) bool {
	parent = filepath.Clean(parent)
	candidate = filepath.Clean(candidate)
	relative, err := filepath.Rel(parent, candidate)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)))
}
```

The check uses the final destination path, including the source basename already appended by the planner. It therefore catches both `folder/folder` and deeper destinations without confusing `folder-two` with `folder`.

- [ ] **Step 5: Run planner and complete operation tests**

```bash
go test ./internal/ops -run 'TestPlan' -v
go test ./internal/ops -v
```

Expected: all planner and operation package tests pass; existing conflict codes remain unchanged.

- [ ] **Step 6: Commit the planner protection**

```bash
git add internal/ops/planner.go internal/ops/planner_test.go
git commit -m "fix: reject recursive directory transfers"
```

### Task 2: Add The Pure Drag And Drop Domain Model

**Files:**
- Create: `web/src/fileDrag.test.ts`
- Create: `web/src/fileDrag.ts`
- Test: `web/src/fileDrag.test.ts`

- [ ] **Step 1: Write failing tests for source selection, operation inference, and destination validation**

Create `web/src/fileDrag.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Entry } from "./api/types";
import {
  buildDragRequest,
  buildFileDragSource,
  defaultDragOperation,
  validateFileDrop,
  type FileDragData,
  type FileDropData,
} from "./fileDrag";

describe("buildFileDragSource", () => {
  it("keeps selected entries in visible order", () => {
    const visibleEntries = [entry("a.txt"), entry("b.txt"), entry("folder", "directory")];
    const source = buildFileDragSource(dragData(visibleEntries[1], visibleEntries, ["b.txt", "a.txt"]));
    expect(source.entries.map((item) => item.relativePath)).toEqual(["a.txt", "b.txt"]);
  });

  it("uses only an unselected dragged entry", () => {
    const visibleEntries = [entry("a.txt"), entry("b.txt")];
    const source = buildFileDragSource(dragData(visibleEntries[1], visibleEntries, ["a.txt"]));
    expect(source.entries.map((item) => item.relativePath)).toEqual(["b.txt"]);
  });
});

it("defaults to move for equal roots and copy for different roots", () => {
  const source = buildFileDragSource(dragData(entry("a.txt"), [entry("a.txt")], []));
  expect(defaultDragOperation(source, drop("left", "root-a", "folder", "directory"))).toBe("move");
  expect(defaultDragOperation(source, drop("right", "root-b", ".", "current-directory"))).toBe("copy");
});

it("rejects the existing parent, self, and descendants without prefix false positives", () => {
  const fileSource = buildFileDragSource(dragData(entry("a.txt"), [entry("a.txt")], []));
  expect(validateFileDrop(fileSource, drop("right", "root-a", ".", "current-directory"))).toEqual({
    valid: false,
    reason: "same-directory",
  });

  const directorySource = buildFileDragSource(
    dragData(entry("folder", "directory"), [entry("folder", "directory")], []),
  );
  expect(validateFileDrop(directorySource, drop("right", "root-a", "folder", "directory"))).toEqual({
    valid: false,
    reason: "inside-source",
  });
  expect(validateFileDrop(directorySource, drop("right", "root-a", "folder/child", "directory"))).toEqual({
    valid: false,
    reason: "inside-source",
  });
  expect(validateFileDrop(directorySource, drop("right", "root-a", "folder-two", "directory"))).toEqual({ valid: true });
});

it("allows different roots and builds the existing OpsRequest shape", () => {
  const source = buildFileDragSource(dragData(entry("a.txt"), [entry("a.txt")], []));
  const target = drop("right", "root-b", "archive", "directory");
  expect(validateFileDrop(source, target)).toEqual({ valid: true });
  expect(buildDragRequest(source, target)).toEqual({
    type: "copy",
    sourceRoot: "root-a",
    sources: ["a.txt"],
    destRoot: "root-b",
    destPath: "archive",
  });
});

function dragData(clicked: Entry, visibleEntries: Entry[], selectedPaths: string[]): FileDragData {
  return {
    kind: "file-entry",
    pane: "left",
    rootId: "root-a",
    parentPath: ".",
    entry: clicked,
    selectedPaths,
    visibleEntries,
  };
}

function drop(
  pane: "left" | "right",
  rootId: string,
  path: string,
  kind: FileDropData["kind"],
): FileDropData {
  return { id: `${pane}:${kind}:${path}`, kind, pane, rootId, path, label: path };
}

function entry(relativePath: string, type: Entry["type"] = "file"): Entry {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  return { name, relativePath, type, size: 1, mode: "", modifiedUnix: 0, isSymlink: false };
}
```

- [ ] **Step 2: Run the focused test and verify the module is missing**

Run from `web/`:

```bash
npm test -- --run src/fileDrag.test.ts
```

Expected: FAIL because `src/fileDrag.ts` does not exist.

- [ ] **Step 3: Commit the red drag-rule tests**

```bash
git add web/src/fileDrag.test.ts
git commit -m "test: cover file drag rules"
```

- [ ] **Step 4: Implement the domain types and pure helpers**

Create `web/src/fileDrag.ts`:

```ts
import type { Entry, OpsRequest } from "./api/types";

export type PaneKey = "left" | "right";
export type DragOperation = Extract<OpsRequest["type"], "move" | "copy">;
export type InvalidDropReason = "same-directory" | "inside-source";

export type FileDragData = {
  kind: "file-entry";
  pane: PaneKey;
  rootId: string;
  parentPath: string;
  entry: Entry;
  selectedPaths: string[];
  visibleEntries: Entry[];
};

export type FileDragSource = {
  pane: PaneKey;
  rootId: string;
  parentPath: string;
  entries: Entry[];
};

export type FileDropData = {
  id: string;
  kind: "directory" | "current-directory";
  pane: PaneKey;
  rootId: string;
  path: string;
  label: string;
};

export type FileDropFeedback = {
  target: FileDropData;
  operation: DragOperation;
  valid: boolean;
  reason?: InvalidDropReason;
};

export function fileDragId(pane: PaneKey, path: string) {
  return `drag:${pane}:${encodeURIComponent(path)}`;
}

export function paneDropId(pane: PaneKey) {
  return `drop:${pane}:current-directory`;
}

export function directoryDropId(pane: PaneKey, path: string) {
  return `drop:${pane}:directory:${encodeURIComponent(path)}`;
}

export function buildFileDragSource(data: FileDragData): FileDragSource {
  const selected = new Set(data.selectedPaths);
  const entries = selected.has(data.entry.relativePath)
    ? data.visibleEntries.filter((entry) => selected.has(entry.relativePath))
    : [data.entry];
  return { pane: data.pane, rootId: data.rootId, parentPath: data.parentPath, entries };
}

export function defaultDragOperation(source: FileDragSource, target: FileDropData): DragOperation {
  return source.rootId === target.rootId ? "move" : "copy";
}

export function validateFileDrop(
  source: FileDragSource,
  target: FileDropData,
): { valid: true } | { valid: false; reason: InvalidDropReason } {
  if (source.rootId !== target.rootId) return { valid: true };

  if (normalizeRelativePath(source.parentPath) === normalizeRelativePath(target.path)) {
    return { valid: false, reason: "same-directory" };
  }

  const targetPath = normalizeRelativePath(target.path);
  const insideSource = source.entries.some(
    (entry) => entry.type === "directory" && isSameOrDescendant(targetPath, normalizeRelativePath(entry.relativePath)),
  );
  return insideSource ? { valid: false, reason: "inside-source" } : { valid: true };
}

export function buildFileDropFeedback(source: FileDragSource, target: FileDropData): FileDropFeedback {
  const validation = validateFileDrop(source, target);
  return {
    target,
    operation: defaultDragOperation(source, target),
    valid: validation.valid,
    reason: validation.valid ? undefined : validation.reason,
  };
}

export function buildDragRequest(source: FileDragSource, target: FileDropData): OpsRequest {
  return {
    type: defaultDragOperation(source, target),
    sourceRoot: source.rootId,
    sources: source.entries.map((entry) => entry.relativePath),
    destRoot: target.rootId,
    destPath: target.path,
  };
}

export function isFileDragData(value: unknown): value is FileDragData {
  return Boolean(value && typeof value === "object" && (value as { kind?: unknown }).kind === "file-entry");
}

export function isFileDropData(value: unknown): value is FileDropData {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === "directory" || kind === "current-directory";
}

function normalizeRelativePath(path: string) {
  const parts = path.split("/").filter((part) => part.length > 0 && part !== ".");
  return parts.join("/") || ".";
}

function isSameOrDescendant(candidate: string, parent: string) {
  return candidate === parent || (parent !== "." && candidate.startsWith(`${parent}/`));
}
```

- [ ] **Step 5: Run the focused drag-rule tests**

```bash
npm test -- --run src/fileDrag.test.ts
```

Expected: all tests pass.

- [ ] **Step 6: Commit the domain model**

```bash
git add web/src/fileDrag.ts web/src/fileDrag.test.ts
git commit -m "feat: add file drag rules"
```

### Task 3: Make Drag-Initiated Operation Previews Switchable

**Files:**
- Modify: `web/src/components/OperationPreview.test.tsx`
- Modify: `web/src/components/OperationPreview.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/i18n.test.ts`
- Modify: `web/src/styles.css`
- Test: `web/src/components/OperationPreview.test.tsx`

- [ ] **Step 1: Add failing tests for operation switching and stale dry-run responses**

Append to `web/src/components/OperationPreview.test.tsx`:

```tsx
it("switches a drag preview from move to copy and submits the selected request", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "target/a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-copy" });
  const onJobCreated = vi.fn();
  const moveRequest = { type: "move" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "a", destPath: "target" };

  render(
    <OperationPreview
      request={moveRequest}
      operationChoices={["move", "copy"]}
      onJobCreated={onJobCreated}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("radio", { name: "move" })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: "copy" }));
  await waitFor(() => expect(api.opsDryRun).toHaveBeenLastCalledWith({ ...moveRequest, type: "copy" }));
  const confirm = screen.getByRole("button", { name: "Start copy" });
  await waitFor(() => expect(confirm).toBeEnabled());
  await userEvent.click(confirm);

  expect(api.opsCreateJob).toHaveBeenCalledWith({ ...moveRequest, type: "copy" });
  expect(onJobCreated).toHaveBeenCalledWith("job-copy");
});

it("does not let an older dry run re-enable the wrong operation", async () => {
  let resolveMove!: (value: { hasConflict: boolean; items: never[] }) => void;
  vi.mocked(api.opsDryRun)
    .mockReturnValueOnce(new Promise((resolve) => { resolveMove = resolve; }))
    .mockResolvedValueOnce({ hasConflict: false, items: [] });
  const moveRequest = { type: "move" as const, sourceRoot: "a", sources: ["a.txt"], destRoot: "a", destPath: "target" };

  render(
    <OperationPreview
      request={moveRequest}
      operationChoices={["move", "copy"]}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  await userEvent.click(screen.getByRole("radio", { name: "copy" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  resolveMove({ hasConflict: false, items: [] });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  expect(screen.queryByRole("button", { name: "Start move" })).not.toBeInTheDocument();
});

it("keeps toolbar previews fixed when operation choices are absent", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({ hasConflict: false, items: [] });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await waitFor(() => expect(api.opsDryRun).toHaveBeenCalled());
  expect(screen.queryByRole("radiogroup", { name: "Operation" })).not.toBeInTheDocument();
});
```

Append to `web/src/i18n.test.ts`:

```ts
it("localizes the drag operation selector", () => {
  expect(strings.en.operationMode).toBe("Operation");
  expect(strings["zh-CN"].operationMode).toBe("操作方式");
});
```

- [ ] **Step 2: Run the focused tests and verify the new prop and label are missing**

```bash
npm test -- --run src/components/OperationPreview.test.tsx src/i18n.test.ts
```

Expected: FAIL because `operationChoices` and `operationMode` do not exist.

- [ ] **Step 3: Commit the red preview tests**

```bash
git add web/src/components/OperationPreview.test.tsx web/src/i18n.test.ts
git commit -m "test: cover selectable operation previews"
```

- [ ] **Step 4: Add localized operation-selector copy**

Add this field to `UIStrings`:

```ts
operationMode: string;
```

Add these exact values to the two dictionaries:

```ts
// en
operationMode: "Operation",

// zh-CN
operationMode: "操作方式",
```

- [ ] **Step 5: Derive one active request inside `OperationPreview`**

Import `useMemo`, add the optional prop, and initialize the selected type:

```tsx
import { useEffect, useMemo, useState } from "react";
import type { DragOperation } from "../fileDrag";

type Props = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function OperationPreview({ request, operationChoices, onJobCreated, onClose, labels = strings.en }: Props) {
  const [selectedType, setSelectedType] = useState<OpsRequest["type"]>(request.type);
  const activeRequest = useMemo(
    () => (selectedType === request.type ? request : { ...request, type: selectedType }),
    [request, selectedType],
  );
```

At the beginning of the dry-run effect, reset stale presentation state, then use `activeRequest` throughout the request and response guard:

```tsx
useEffect(() => {
  let active = true;
  setItems([]);
  setHasConflict(false);
  setError(null);
  setLoading(true);
  setPreviewedRequest(null);

  api
    .opsDryRun(activeRequest)
    .then((plan) => {
      if (!active) return;
      setItems(plan.items);
      setHasConflict(plan.hasConflict);
      setPreviewedRequest(activeRequest);
    })
    .catch((err) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : labels.previewFailed);
    })
    .finally(() => {
      if (active) setLoading(false);
    });
  return () => {
    active = false;
  };
}, [activeRequest, labels.previewFailed]);
```

Replace every operation-sensitive use of `request` in `confirm`, titles, descriptions, item count, destructive/column flags, path display calls, the confirmation label, and the request-identity disabled check with `activeRequest`. In particular:

```tsx
const job = await api.opsCreateJob(activeRequest);
const itemCount = activeRequest.type === "mkdir" ? 1 : activeRequest.sources.length;
const destructive = activeRequest.type === "delete";
const showSourceColumn = activeRequest.type !== "mkdir";
const showDestinationColumn = activeRequest.type !== "delete";

disabled={previewedRequest !== activeRequest || hasConflict || loading || submitting}
```

- [ ] **Step 6: Render the compact shadcn/ui-style segmented control only for drag previews**

Place this between `DialogDescription` and `ErrorBanner`:

```tsx
{operationChoices?.length ? (
  <div className="operation-type-switch" role="radiogroup" aria-label={labels.operationMode}>
    {operationChoices.map((type) => (
      <Button
        key={type}
        type="button"
        size="sm"
        variant="ghost"
        role="radio"
        aria-checked={activeRequest.type === type}
        data-active={activeRequest.type === type ? "true" : "false"}
        onClick={() => setSelectedType(type)}
        disabled={submitting}
      >
        {labels.operationType(type)}
      </Button>
    ))}
  </div>
) : null}
```

Add to `web/src/styles.css` beside the dialog/menu component rules:

```css
.operation-type-switch {
  width: fit-content;
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--muted);
}

.operation-type-switch [role="radio"] {
  min-width: 72px;
}

.operation-type-switch [role="radio"][data-active="true"] {
  background: var(--background);
  color: var(--foreground);
  box-shadow: 0 1px 3px color-mix(in oklab, var(--foreground) 12%, transparent);
}
```

- [ ] **Step 7: Run preview, localization, and existing operation tests**

```bash
npm test -- --run src/components/OperationPreview.test.tsx src/i18n.test.ts
```

Expected: all focused tests pass, including fixed-operation regression tests.

- [ ] **Step 8: Commit the selectable preview**

```bash
git add web/src/components/OperationPreview.tsx web/src/components/OperationPreview.test.tsx web/src/i18n.ts web/src/i18n.test.ts web/src/styles.css
git commit -m "feat: switch drag preview operation"
```

### Task 4: Share File Actions Between The Toolbar And Context Menu

**Files:**
- Create: `web/src/components/fileActions.test.ts`
- Create: `web/src/components/fileActions.ts`
- Modify: `web/src/components/ActionToolbar.test.tsx`
- Modify: `web/src/components/ActionToolbar.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Test: `web/src/components/fileActions.test.ts`
- Test: `web/src/components/ActionToolbar.test.tsx`

- [ ] **Step 1: Add failing tests for one ordered action definition**

Create `web/src/components/fileActions.test.ts`:

```ts
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { createFileActions } from "./fileActions";

it("creates every toolbar action in display order", () => {
  const actions = createFileActions({
    destination: strings.en.rightPane,
    selectedCount: 2,
    labels: strings.en,
    commands: commands(),
  });

  expect(actions.map((action) => action.id)).toEqual([
    "copy", "move", "symlink", "hardlink", "mkdir", "rename", "powerRename", "delete",
  ]);
  expect(actions.find((action) => action.id === "mkdir")?.separatorBefore).toBe(true);
  expect(actions.find((action) => action.id === "delete")?.separatorBefore).toBe(true);
});

it("uses the same enabled predicates as the existing toolbar", () => {
  const none = createFileActions({ destination: "Right pane", selectedCount: 0, labels: strings.en, commands: commands() });
  expect(none.find((action) => action.id === "mkdir")?.disabled).toBe(false);
  expect(none.filter((action) => action.id !== "mkdir").every((action) => action.disabled)).toBe(true);

  const one = createFileActions({ destination: "Right pane", selectedCount: 1, labels: strings.en, commands: commands() });
  expect(one.find((action) => action.id === "rename")?.disabled).toBe(false);

  const many = createFileActions({ destination: "Right pane", selectedCount: 2, labels: strings.en, commands: commands() });
  expect(many.find((action) => action.id === "rename")?.disabled).toBe(true);
  expect(many.find((action) => action.id === "powerRename")?.disabled).toBe(false);
});

it("dispatches commands from the shared descriptors", () => {
  const handlers = commands();
  const actions = createFileActions({ destination: "Right pane", selectedCount: 1, labels: strings.en, commands: handlers });

  actions.find((action) => action.id === "copy")?.run();
  actions.find((action) => action.id === "rename")?.run();
  expect(handlers.onOperation).toHaveBeenCalledWith("copy");
  expect(handlers.onRename).toHaveBeenCalledOnce();
});

function commands() {
  return {
    onOperation: vi.fn(),
    onMkdir: vi.fn(),
    onRename: vi.fn(),
    onPowerRename: vi.fn(),
  };
}
```

- [ ] **Step 2: Run the action tests and verify the descriptor module is missing**

```bash
npm test -- --run src/components/fileActions.test.ts
```

Expected: FAIL because `fileActions.ts` does not exist.

- [ ] **Step 3: Commit the red shared-action tests**

```bash
git add web/src/components/fileActions.test.ts
git commit -m "test: cover shared file actions"
```

- [ ] **Step 4: Implement the action descriptor factory**

Create `web/src/components/fileActions.ts`:

```ts
import {
  Copy, FolderPlus, Link, Link2, MoveRight, Pencil, ScanText, Trash2,
  type LucideIcon,
} from "lucide-react";
import type { OpsRequest } from "../api/types";
import type { UIStrings } from "../i18n";

export type FileActionId = "copy" | "move" | "symlink" | "hardlink" | "mkdir" | "rename" | "powerRename" | "delete";
export type CommandOperation = Exclude<OpsRequest["type"], "mkdir">;

export type FileAction = {
  id: FileActionId;
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  separatorBefore?: boolean;
  destructive?: boolean;
  run(): void;
};

export type FileActionCommands = {
  onOperation(type: CommandOperation): void;
  onMkdir(): void;
  onRename(): void;
  onPowerRename(): void;
};

export function createFileActions({
  destination,
  selectedCount,
  labels,
  commands,
}: {
  destination: string;
  selectedCount: number;
  labels: UIStrings;
  commands: FileActionCommands;
}): FileAction[] {
  const noSelection = selectedCount === 0;
  return [
    { id: "copy", label: labels.copyToPane(destination), icon: Copy, disabled: noSelection, run: () => commands.onOperation("copy") },
    { id: "move", label: labels.moveToPane(destination), icon: MoveRight, disabled: noSelection, run: () => commands.onOperation("move") },
    { id: "symlink", label: labels.symlink, icon: Link, disabled: noSelection, run: () => commands.onOperation("symlink") },
    { id: "hardlink", label: labels.hardlink, icon: Link2, disabled: noSelection, run: () => commands.onOperation("hardlink") },
    { id: "mkdir", label: labels.mkdir, icon: FolderPlus, disabled: false, separatorBefore: true, run: commands.onMkdir },
    { id: "rename", label: labels.rename, icon: Pencil, disabled: selectedCount !== 1, run: commands.onRename },
    { id: "powerRename", label: labels.powerRename, icon: ScanText, disabled: noSelection, run: commands.onPowerRename },
    { id: "delete", label: labels.delete, icon: Trash2, disabled: noSelection, separatorBefore: true, destructive: true, run: () => commands.onOperation("delete") },
  ];
}
```

- [ ] **Step 5: Make `ActionToolbar` render descriptors instead of defining commands**

Replace its props and button body with:

```tsx
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { UIStrings } from "../i18n";
import type { FileAction } from "./fileActions";

type Props = {
  actions: FileAction[];
  selectedCount: number;
  labels: UIStrings;
};

export function ActionToolbar({ actions, selectedCount, labels }: Props) {
  return (
    <nav aria-label={labels.fileActions} className="flex h-[42px] items-center gap-1.5 border-b bg-slate-50 px-3">
      {actions.map((action, index) => {
        const Icon = action.icon;
        return (
          <Fragment key={action.id}>
            {action.separatorBefore ? <Separator orientation="vertical" className="mx-1 h-5" /> : null}
            <Button
              size="sm"
              variant={index === 0 ? "default" : action.destructive ? "ghost" : "outline"}
              aria-label={action.label}
              data-action-id={action.id}
              className={action.destructive ? "text-destructive hover:text-destructive" : undefined}
              onClick={action.run}
              disabled={action.disabled}
            >
              <Icon /><span className="action-label">{action.label}</span>
            </Button>
          </Fragment>
        );
      })}
      <span className="ml-auto text-xs text-slate-500">{labels.selectionSummary(selectedCount)}</span>
    </nav>
  );
}
```

Add `fileActions: string` to `UIStrings`, with `"File actions"` and `"文件操作"` in the English and Chinese dictionaries.

- [ ] **Step 6: Build pane-specific actions in `DualPane`**

Import `createFileActions`, move `PaneKey` to the shared `fileDrag.ts` type, and replace the toolbar props with:

```tsx
<ActionToolbar
  actions={actionsFor(activePane)}
  selectedCount={selectionFor(activePane).length}
  labels={labels}
/>
```

Add these helpers inside `DualPane` and use them from existing dialogs and commands:

```tsx
function stateFor(which: PaneKey) {
  return which === "left" ? left : right;
}

function oppositePane(which: PaneKey): PaneKey {
  return which === "left" ? "right" : "left";
}

function selectionFor(which: PaneKey) {
  const state = stateFor(which);
  const ordered = state.visibleOrder.filter((path) => state.selected.has(path));
  const visible = new Set(state.visibleOrder);
  return [...ordered, ...Array.from(state.selected).filter((path) => !visible.has(path))];
}

function actionsFor(which: PaneKey) {
  const destinationPane = oppositePane(which);
  return createFileActions({
    destination: destinationPane === "left" ? labels.leftPane : labels.rightPane,
    selectedCount: selectionFor(which).length,
    labels,
    commands: {
      onOperation: (type) => openOperationFrom(which, type),
      onMkdir: () => {
        setActivePane(which);
        setMkdirOpen(true);
      },
      onRename: () => {
        setActivePane(which);
        setSingleRenameOpen(true);
      },
      onPowerRename: () => {
        setActivePane(which);
        setPowerRenameOpen(true);
      },
    },
  });
}

function openOperationFrom(which: PaneKey, type: OpsRequest["type"]) {
  const source = stateFor(which);
  const dest = stateFor(oppositePane(which));
  setActivePane(which);
  setPreviewState({
    request: {
      type,
      sourceRoot: source.rootId,
      sources: selectionFor(which),
      destRoot: type === "delete" ? undefined : dest.rootId,
      destPath: type === "delete" ? undefined : dest.path,
    },
  });
}
```

Rename the current `previewRequest` state to this forward-compatible shape; Task 7 will populate `operationChoices` for drag requests:

```tsx
type PreviewState = {
  request: OpsRequest;
  operationChoices?: readonly DragOperation[];
};

const [previewState, setPreviewState] = useState<PreviewState | null>(null);
```

Replace the current operation-preview block with:

```tsx
{previewState ? (
  <OperationPreview
    request={previewState.request}
    operationChoices={previewState.operationChoices}
    labels={labels}
    onClose={() => setPreviewState(null)}
    onJobCreated={(id) => {
      setPreviewState(null);
      handleJobCreated(id);
    }}
  />
) : null}
```

Replace `createMkdirPreview` with:

```tsx
function createMkdirPreview(name: string) {
  const source = stateFor(activePane);
  setPreviewState({
    request: {
      type: "mkdir",
      sourceRoot: source.rootId,
      sources: [],
      destRoot: source.rootId,
      destPath: source.path,
      newName: name,
    },
  });
}
```

- [ ] **Step 7: Update toolbar tests to construct descriptors**

Replace `ActionToolbar.test.tsx` with:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { ActionToolbar } from "./ActionToolbar";
import { createFileActions, type FileActionCommands } from "./fileActions";

it("labels transfer actions with the opposite pane", async () => {
  const commands = commandMocks();
  render(<ActionToolbar actions={actions(2, commands)} selectedCount={2} labels={strings.en} />);

  await userEvent.click(screen.getByRole("button", { name: "Copy to right pane" }));
  expect(commands.onOperation).toHaveBeenCalledWith("copy");
  expect(screen.getByRole("button", { name: "Move to right pane" })).toBeEnabled();
});

it("keeps rename limited to a single selection", () => {
  const commands = commandMocks();
  const { rerender } = render(<ActionToolbar actions={actions(0, commands)} selectedCount={0} labels={strings.en} />);
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();

  rerender(<ActionToolbar actions={actions(1, commands)} selectedCount={1} labels={strings.en} />);
  expect(screen.getByRole("button", { name: "Rename" })).toBeEnabled();
});

function actions(selectedCount: number, commands: FileActionCommands) {
  return createFileActions({ destination: strings.en.rightPane, selectedCount, labels: strings.en, commands });
}

function commandMocks(): FileActionCommands {
  return {
    onOperation: vi.fn(),
    onMkdir: vi.fn(),
    onRename: vi.fn(),
    onPowerRename: vi.fn(),
  };
}
```

- [ ] **Step 8: Run shared-action, toolbar, and DualPane regression tests**

```bash
npm test -- --run src/components/fileActions.test.ts src/components/ActionToolbar.test.tsx src/components/DualPane.test.tsx src/i18n.test.ts
```

Expected: all focused tests pass and current toolbar workflows still create the same requests.

- [ ] **Step 9: Commit the shared action model**

```bash
git add web/src/components/fileActions.ts web/src/components/fileActions.test.ts web/src/components/ActionToolbar.tsx web/src/components/ActionToolbar.test.tsx web/src/components/DualPane.tsx web/src/i18n.ts web/src/i18n.test.ts
git commit -m "refactor: share file action definitions"
```

### Task 5: Add The Toolbar-Equivalent Context Menu

**Files:**
- Create: `web/src/components/ui/context-menu.tsx`
- Create: `web/src/components/PaneContextMenu.test.tsx`
- Create: `web/src/components/PaneContextMenu.tsx`
- Modify: `web/src/components/FilePane.test.tsx`
- Modify: `web/src/components/FilePane.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/styles.css`
- Test: `web/src/components/PaneContextMenu.test.tsx`
- Test: `web/src/components/FilePane.test.tsx`
- Test: `web/src/components/DualPane.test.tsx`

- [ ] **Step 1: Add failing context-menu rendering tests**

Create `web/src/components/PaneContextMenu.test.tsx`:

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { strings } from "../i18n";
import { createFileActions } from "./fileActions";
import { PaneContextMenu } from "./PaneContextMenu";

it("renders every shared action and dispatches enabled items", async () => {
  const onMkdir = vi.fn();
  const actions = createFileActions({
    destination: strings.en.rightPane,
    selectedCount: 1,
    labels: strings.en,
    commands: { onOperation: vi.fn(), onMkdir, onRename: vi.fn(), onPowerRename: vi.fn() },
  });
  render(
    <PaneContextMenu actions={actions} label={strings.en.fileActions}>
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(menu).getAllByRole("menuitem")).toHaveLength(8);
  await userEvent.click(within(menu).getByRole("menuitem", { name: "mkdir" }));
  expect(onMkdir).toHaveBeenCalledOnce();
});

it("shows every empty-selection action while disabling all except mkdir", async () => {
  const actions = createFileActions({
    destination: strings.en.rightPane,
    selectedCount: 0,
    labels: strings.en,
    commands: { onOperation: vi.fn(), onMkdir: vi.fn(), onRename: vi.fn(), onPowerRename: vi.fn() },
  });
  render(
    <PaneContextMenu actions={actions} label={strings.en.fileActions}>
      <div data-testid="target">Target</div>
    </PaneContextMenu>,
  );

  fireEvent.contextMenu(screen.getByTestId("target"), { clientX: 80, clientY: 60 });
  const items = within(await screen.findByRole("menu", { name: "File actions" })).getAllByRole("menuitem");
  expect(items).toHaveLength(8);
  expect(items.find((item) => item.dataset.actionId === "mkdir")).not.toHaveAttribute("aria-disabled", "true");
  expect(items.filter((item) => item.dataset.actionId !== "mkdir").every(
    (item) => item.getAttribute("aria-disabled") === "true",
  )).toBe(true);
});
```

- [ ] **Step 2: Add failing FilePane tests for row and whitespace targets**

Add `onContextTarget: vi.fn()` and `actions: []` to the `renderPane` defaults in `FilePane.test.tsx`, then append:

```tsx
it("reports the right-clicked entry before opening its context menu", () => {
  const onContextTarget = vi.fn();
  renderPane({ onContextTarget });

  fireEvent.contextMenu(screen.getByText("file.txt"), { clientX: 50, clientY: 50 });
  expect(onContextTarget).toHaveBeenCalledWith("file.txt");
});

it("reports null when list whitespace is right-clicked", () => {
  const onContextTarget = vi.fn();
  renderPane({ onContextTarget });

  fireEvent.contextMenu(screen.getByTestId("file-list-left"), { clientX: 500, clientY: 400 });
  expect(onContextTarget).toHaveBeenCalledWith(null);
});
```

- [ ] **Step 3: Run the focused context tests and verify components/props are missing**

```bash
npm test -- --run src/components/PaneContextMenu.test.tsx src/components/FilePane.test.tsx
```

Expected: FAIL because `PaneContextMenu`, `actions`, `onContextTarget`, and the file-list test ID do not exist.

- [ ] **Step 4: Commit the red context-menu tests**

```bash
git add web/src/components/PaneContextMenu.test.tsx web/src/components/FilePane.test.tsx
git commit -m "test: cover file context menu"
```

- [ ] **Step 5: Add Base UI ContextMenu wrappers with existing menu data slots**

Create `web/src/components/ui/context-menu.tsx`:

```tsx
import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

function ContextMenuRoot(props: ComponentProps<typeof ContextMenuPrimitive.Root>) {
  return <ContextMenuPrimitive.Root {...props} />;
}

function ContextMenuTrigger({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Trigger>) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" className={cn(className)} {...props} />;
}

function ContextMenuPortal(props: ComponentProps<typeof ContextMenuPrimitive.Portal>) {
  return <ContextMenuPrimitive.Portal {...props} />;
}

function ContextMenuPositioner({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Positioner>) {
  return <ContextMenuPrimitive.Positioner className={cn(className)} {...props} />;
}

function ContextMenuPopup({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Popup>) {
  return <ContextMenuPrimitive.Popup data-slot="menu-popup" className={cn(className)} {...props} />;
}

function ContextMenuItem({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return <ContextMenuPrimitive.Item data-slot="menu-item" className={cn(className)} {...props} />;
}

function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return <ContextMenuPrimitive.Separator data-slot="menu-separator" className={cn(className)} {...props} />;
}

export {
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
};
```

- [ ] **Step 6: Render the shared descriptors as a context menu**

Create `web/src/components/PaneContextMenu.tsx`:

```tsx
import { Fragment, type ReactElement } from "react";
import {
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuPortal,
  ContextMenuPositioner,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { FileAction } from "./fileActions";

export function PaneContextMenu({
  actions,
  label,
  children,
}: {
  actions: FileAction[];
  label: string;
  children: ReactElement;
}) {
  return (
    <ContextMenuRoot>
      <ContextMenuTrigger render={children} />
      <ContextMenuPortal>
        <ContextMenuPositioner>
          <ContextMenuPopup aria-label={label}>
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Fragment key={action.id}>
                  {action.separatorBefore ? <ContextMenuSeparator className="file-action-menu-separator" /> : null}
                  <ContextMenuItem
                    data-action-id={action.id}
                    className={action.destructive ? "file-action-menu-item text-destructive" : "file-action-menu-item"}
                    disabled={action.disabled}
                    onClick={action.run}
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span>{action.label}</span>
                  </ContextMenuItem>
                </Fragment>
              );
            })}
          </ContextMenuPopup>
        </ContextMenuPositioner>
      </ContextMenuPortal>
    </ContextMenuRoot>
  );
}
```

Add these rules to `web/src/styles.css` below the existing menu item states:

```css
.file-action-menu-item {
  gap: 8px;
}

[data-slot="menu-separator"].file-action-menu-separator {
  height: 1px;
  margin: 4px 2px;
  background: var(--border);
}
```

- [ ] **Step 7: Wrap the `FilePane` list and emit context target intent**

Add these props:

```tsx
import type { FileAction } from "./fileActions";
import { PaneContextMenu } from "./PaneContextMenu";
import type { PaneKey } from "../fileDrag";

type FilePaneProps = {
  paneKey?: PaneKey;
  actions?: FileAction[];
  onContextTarget?(path: string | null): void;
};
```

Keep every existing `FilePaneProps` field beside these additions. Add defaults in the component parameter list so direct component tests and non-menu callers retain their current behavior:

```tsx
paneKey = "left",
actions = [],
onContextTarget = () => undefined,
```

Replace the `.file-list` opening/closing element with this wrapper, preserving all current loading, error, table, and marquee children inside the inner `div`:

```tsx
<PaneContextMenu actions={actions} label={labels.fileActions}>
  <div
    className="file-list"
    data-testid={`file-list-${paneKey}`}
    ref={fileListRef}
    onMouseDown={startDragSelection}
    onContextMenuCapture={(event) => {
      onActivate();
      const element = event.target instanceof Element ? event.target : null;
      const row = element?.closest<HTMLTableRowElement>("tbody tr[data-entry-path]");
      onContextTarget(row?.dataset.entryPath ?? null);
    }}
  >
```

Change only the current `.file-list` opening tag to the snippet above. Keep its existing loading, error, empty-state, table, and marquee nodes unchanged, then add `</div></PaneContextMenu>` where the original list `</div>` currently closes.

- [ ] **Step 8: Apply the approved selection rule in `DualPane` and pass pane actions**

Add to `paneProps`:

```tsx
paneKey: which,
actions: actionsFor(which),
onContextTarget: (path: string | null) => selectContextTarget(which, path),
```

Add the pane-specific selection helper:

```tsx
function selectContextTarget(which: PaneKey, path: string | null) {
  setActivePane(which);
  updatePane(which, (current) => {
    if (path === null) {
      return current.selected.size ? { ...current, selected: new Set() } : current;
    }
    if (current.selected.has(path)) return current;
    return { ...current, selected: new Set([path]) };
  });
}
```

This preserves a right-clicked member of an existing selection, replaces selection for an unselected row, and clears only the clicked pane on whitespace.

- [ ] **Step 9: Add DualPane integration coverage for context selection and disabled actions**

Append tests using two entries returned by the mocked browse API:

```tsx
it("preserves a selected group when opening the row context menu", async () => {
  mockTwoEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(within(leftPane).getByLabelText("Select a.txt"));
  await userEvent.click(within(leftPane).getByLabelText("Select b.txt"));

  fireEvent.contextMenu(within(leftPane).getByText("a.txt"), { clientX: 100, clientY: 100 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  expect(within(menu).getByRole("menuitem", { name: "Rename" })).toHaveAttribute("aria-disabled", "true");
  expect(within(menu).getByRole("menuitem", { name: "PowerRename" })).not.toHaveAttribute("aria-disabled", "true");
});

it("clears selection on whitespace but keeps every action visible", async () => {
  mockTwoEntries();
  render(<DualPane />);
  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  await userEvent.click(within(leftPane).getByLabelText("Select a.txt"));

  fireEvent.contextMenu(within(leftPane).getByTestId("file-list-left"), { clientX: 500, clientY: 400 });
  const menu = await screen.findByRole("menu", { name: "File actions" });
  const items = within(menu).getAllByRole("menuitem");
  expect(items).toHaveLength(8);
  expect(items.find((item) => item.dataset.actionId === "mkdir")).not.toHaveAttribute("aria-disabled", "true");
  expect(items.filter((item) => item.dataset.actionId !== "mkdir").every((item) => item.getAttribute("aria-disabled") === "true")).toBe(true);
});
```

Add this helper beside the existing DualPane test helpers:

```tsx
function mockTwoEntries() {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "b.txt", relativePath: "b.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
}
```

- [ ] **Step 10: Run the complete context-menu focus set**

```bash
npm test -- --run src/components/PaneContextMenu.test.tsx src/components/FilePane.test.tsx src/components/DualPane.test.tsx src/components/ActionToolbar.test.tsx
```

Expected: all tests pass; every menu has eight items and current toolbar tests remain green.

- [ ] **Step 11: Commit the context menu**

```bash
git add web/src/components/ui/context-menu.tsx web/src/components/PaneContextMenu.tsx web/src/components/PaneContextMenu.test.tsx web/src/components/FilePane.tsx web/src/components/FilePane.test.tsx web/src/components/DualPane.tsx web/src/components/DualPane.test.tsx web/src/styles.css
git commit -m "feat: add file context menu"
```

### Task 6: Register Draggable Rows And Pane/Directory Drop Targets

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Create: `web/src/components/FileRow.tsx`
- Modify: `web/src/components/FilePane.test.tsx`
- Modify: `web/src/components/FilePane.tsx`
- Modify: `web/src/styles.css`
- Test: `web/src/components/FilePane.test.tsx`

- [ ] **Step 1: Add failing FilePane tests for drag registration and marquee isolation**

Import `DndContext` in `FilePane.test.tsx` and make `renderPane` render the pane inside it:

```tsx
return render(
  <DndContext>
    <FilePane {...props} />
  </DndContext>,
);
```

Append these tests:

```tsx
it("registers files as drag sources and directories as nested drop targets", () => {
  renderPane({ entries: [entry("file.txt"), entry("folder", "directory")] });

  const fileRow = screen.getByText("file.txt").closest("tr");
  const directoryRow = screen.getByText("folder").closest("tr");
  expect(fileRow).toHaveAttribute("data-file-drag-source", "true");
  expect(fileRow).not.toHaveAttribute("data-drop-kind", "directory");
  expect(directoryRow).toHaveAttribute("data-file-drag-source", "true");
  expect(directoryRow).toHaveAttribute("data-drop-kind", "directory");
});

it("does not start marquee selection from a draggable row", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ onSelectPaths });
  const row = screen.getByText("file.txt").closest("tr");
  expect(row).not.toBeNull();

  fireEvent.mouseDown(row!, { button: 0, clientX: 20, clientY: 20 });
  fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });
  expect(container.querySelector(".drag-selection-box")).not.toBeInTheDocument();
  fireEvent.mouseUp(document);
  expect(onSelectPaths).not.toHaveBeenCalled();
});

it("keeps the checkbox interactive instead of using it as a drag activator", async () => {
  const onToggleSelection = vi.fn();
  renderPane({ onToggleSelection });
  await userEvent.click(screen.getByLabelText("Select file.txt"));
  expect(onToggleSelection).toHaveBeenCalledWith("file.txt");
});
```

Keep the optional `FilePane` defaults from Task 5; pass `dropFeedback={null}` only in tests that need to override feedback explicitly.

- [ ] **Step 2: Run the focused tests and verify drag attributes are absent**

```bash
npm test -- --run src/components/FilePane.test.tsx
```

Expected: the new registration tests fail, and the existing marquee test demonstrates why row starts must be excluded.

- [ ] **Step 3: Commit the red row-drag tests**

```bash
git add web/src/components/FilePane.test.tsx
git commit -m "test: cover draggable file rows"
```

- [ ] **Step 4: Install the focused drag-and-drop dependency**

Run from `web/`:

```bash
npm install @dnd-kit/core
```

Expected: `@dnd-kit/core` appears under `dependencies`, and the lock file records its resolved version and transitive packages.

- [ ] **Step 5: Create the row component with a 6-pixel activator contract**

Create `web/src/components/FileRow.tsx`:

```tsx
import { useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { Checkbox } from "@/components/ui/checkbox";
import type { Entry } from "../api/types";
import { formatBytes } from "../format";
import type { UIStrings } from "../i18n";
import {
  directoryDropId,
  fileDragId,
  type FileDragData,
  type FileDropData,
  type FileDropFeedback,
  type PaneKey,
} from "../fileDrag";
import { FileIcon } from "./FileIcon";

type Props = {
  paneKey: PaneKey;
  rootId: string;
  entry: Entry;
  selected: boolean;
  dragData: FileDragData;
  dropFeedback: FileDropFeedback | null;
  labels: UIStrings;
  onToggleSelection(path: string): void;
  onOpen(entry: Entry): void;
};

export function FileRow({
  paneKey,
  rootId,
  entry,
  selected,
  dragData,
  dropFeedback,
  labels,
  onToggleSelection,
  onOpen,
}: Props) {
  const drag = useDraggable({
    id: fileDragId(paneKey, entry.relativePath),
    data: dragData,
    attributes: { role: "row", tabIndex: -1 },
  });
  const directoryTarget: FileDropData = {
    id: directoryDropId(paneKey, entry.relativePath),
    kind: "directory",
    pane: paneKey,
    rootId,
    path: entry.relativePath,
    label: entry.name,
  };
  const drop = useDroppable({
    id: directoryTarget.id,
    data: directoryTarget,
    disabled: entry.type !== "directory",
  });
  const setNodeRef = useCallback((node: HTMLTableRowElement | null) => {
    drag.setNodeRef(node);
    drop.setNodeRef(node);
  }, [drag.setNodeRef, drop.setNodeRef]);
  const feedback = dropFeedback?.target.id === directoryTarget.id ? dropFeedback : null;

  return (
    <tr
      ref={setNodeRef}
      {...drag.attributes}
      {...drag.listeners}
      role="row"
      data-entry-path={entry.relativePath}
      data-density="compact"
      data-file-drag-source="true"
      data-dragging={drag.isDragging ? "true" : "false"}
      data-drop-kind={entry.type === "directory" ? "directory" : undefined}
      data-drop-state={feedback ? (feedback.valid ? "valid" : "invalid") : undefined}
      className={entry.type === "directory" ? "directory-row" : undefined}
      onDoubleClick={() => onOpen(entry)}
    >
      <td className="select-cell">
        <Checkbox
          aria-label={labels.selectEntry(entry.name)}
          checked={selected}
          onPointerDown={(event) => event.stopPropagation()}
          onCheckedChange={() => onToggleSelection(entry.relativePath)}
        />
      </td>
      <td>
        <span className="flex min-w-0 items-center gap-1.5">
          <FileIcon name={entry.name} type={entry.type} />
          <span className="truncate font-medium text-slate-700">{entry.name}</span>
          {entry.isSymlink && entry.symlinkTarget ? (
            <small className="truncate text-slate-400">{" -> "}{entry.symlinkTarget}</small>
          ) : null}
        </span>
      </td>
      <td>{entry.type}</td>
      <td>{formatBytes(entry.size)}</td>
      <td>{entry.modifiedUnix ? new Date(entry.modifiedUnix * 1000).toLocaleString() : ""}</td>
    </tr>
  );
}
```

The activation distance itself belongs to the `PointerSensor` in Task 7. Keeping the row's semantic role and `tabIndex: -1` prevents `dnd-kit` from turning table rows into keyboard buttons; the existing toolbar remains the keyboard operation surface.

- [ ] **Step 6: Register the pane current directory and render `FileRow`**

Add optional `dropFeedback?: FileDropFeedback | null` to `FilePaneProps`, default it to `null` in the component parameter list, and import `useDroppable`, `FileRow`, and the drag/drop types. Build the current-directory target in `FilePane`:

```tsx
const paneTarget: FileDropData = {
  id: paneDropId(paneKey),
  kind: "current-directory",
  pane: paneKey,
  rootId: selectedRootId,
  path: currentPath,
  label: labels.currentDirectory,
};
const paneDrop = useDroppable({
  id: paneTarget.id,
  data: paneTarget,
  disabled: loading || Boolean(error),
});

const setFileListNode = useCallback((node: HTMLDivElement | null) => {
  fileListRef.current = node;
  paneDrop.setNodeRef(node);
}, [paneDrop.setNodeRef]);
```

Use `setFileListNode` as the wrapped list's ref and add its feedback state:

```tsx
data-drop-state={dropFeedback?.target.id === paneTarget.id ? (dropFeedback.valid ? "valid" : "invalid") : undefined}
```

Replace the current row body with:

```tsx
{visibleEntries.map((entry) => (
  <FileRow
    key={entry.relativePath}
    paneKey={paneKey}
    rootId={selectedRootId}
    entry={entry}
    selected={selectedPaths.has(entry.relativePath)}
    dragData={{
      kind: "file-entry",
      pane: paneKey,
      rootId: selectedRootId,
      parentPath: currentPath,
      entry,
      selectedPaths: Array.from(selectedPaths),
      visibleEntries,
    }}
    dropFeedback={dropFeedback}
    labels={labels}
    onToggleSelection={onToggleSelection}
    onOpen={(item) => {
      if (item.type === "directory") onPathChange(item.relativePath);
      else onOpenFile?.(item);
    }}
  />
))}
```

Add `useCallback` to the React import. Add `currentDirectory: string` to `UIStrings` with `"Current directory"` and `"当前文件夹"` values.

- [ ] **Step 7: Restrict marquee starts to list whitespace**

Extend `isDragBlockedTarget` in `FilePane.tsx`:

```ts
return target instanceof Element && Boolean(
  target.closest("button, input, select, textarea, a, thead, [data-entry-path], [role='checkbox'], [role='separator']"),
);
```

This is the only marquee behavior change: blank-space drags still calculate intersecting rows exactly as before.

- [ ] **Step 8: Add drag/drop state styling without changing table dimensions**

Append beside the current table row rules:

```css
.file-table tbody tr[data-file-drag-source="true"],
.file-table tbody tr[data-file-drag-source="true"] td:not(.select-cell),
.file-table tbody tr[data-file-drag-source="true"] td:not(.select-cell) * {
  cursor: grab;
}

.file-table tbody tr[data-file-drag-source="true"]:active,
.file-table tbody tr[data-file-drag-source="true"]:active td:not(.select-cell),
.file-table tbody tr[data-file-drag-source="true"]:active td:not(.select-cell) * {
  cursor: grabbing;
}

.file-table tbody tr[data-dragging="true"] {
  opacity: 0.45;
}

.file-table tbody tr[data-drop-state="valid"] {
  background: color-mix(in oklab, var(--primary) 10%, var(--card));
  box-shadow: inset 0 0 0 2px var(--primary);
}

.file-table tbody tr[data-drop-state="invalid"] {
  background: color-mix(in oklab, var(--destructive) 8%, var(--card));
  box-shadow: inset 0 0 0 2px var(--destructive);
}

.file-table tbody tr[data-drop-state="invalid"],
.file-table tbody tr[data-drop-state="invalid"] td:not(.select-cell),
.file-table tbody tr[data-drop-state="invalid"] td:not(.select-cell) * {
  cursor: not-allowed;
}

.file-list[data-drop-state="valid"] {
  box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--primary) 70%, transparent);
}

.file-list[data-drop-state="invalid"] {
  cursor: not-allowed;
  box-shadow: inset 0 0 0 2px color-mix(in oklab, var(--destructive) 70%, transparent);
}
```

- [ ] **Step 9: Run FilePane, localization, and style regression tests**

```bash
npm test -- --run src/components/FilePane.test.tsx src/i18n.test.ts src/styles.test.ts
```

Expected: all tests pass, including existing sorting, resizing, breadcrumb, checkbox, and blank-space marquee cases.

- [ ] **Step 10: Commit dependency and row/drop registration**

```bash
git add web/package.json web/package-lock.json web/src/components/FileRow.tsx web/src/components/FilePane.tsx web/src/components/FilePane.test.tsx web/src/i18n.ts web/src/i18n.test.ts web/src/styles.css
git commit -m "feat: register file drag targets"
```

### Task 7: Coordinate Same-Pane And Cross-Pane Dragging

**Files:**
- Create: `web/src/components/FileDragOverlay.test.tsx`
- Create: `web/src/components/FileDragOverlay.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/i18n.test.ts`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/styles.css`
- Test: `web/src/components/FileDragOverlay.test.tsx`
- Test: `web/src/fileDrag.test.ts`
- Test: `web/src/components/DualPane.test.tsx`

- [ ] **Step 1: Add failing overlay and localization tests**

Create `web/src/components/FileDragOverlay.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import type { Entry } from "../api/types";
import type { FileDragSource, FileDropFeedback } from "../fileDrag";
import { strings } from "../i18n";
import { FileDragOverlay } from "./FileDragOverlay";

it("shows the first item, total count, inferred operation, and destination", () => {
  render(
    <FileDragOverlay
      source={source([entry("a.txt"), entry("b.txt")])}
      feedback={feedback("move", "folder")}
      labels={strings.en}
    />,
  );

  expect(screen.getByText("a.txt and 1 more")).toBeInTheDocument();
  expect(screen.getByText("move to folder")).toBeInTheDocument();
  expect(screen.getByLabelText("2 selected")).toHaveTextContent("2");
});

it("shows only the source summary before entering a target", () => {
  render(<FileDragOverlay source={source([entry("a.txt")])} feedback={null} labels={strings.en} />);
  expect(screen.getByText("a.txt")).toBeInTheDocument();
  expect(screen.queryByText(/ to /)).not.toBeInTheDocument();
});

function source(entries: Entry[]): FileDragSource {
  return { pane: "left", rootId: "root", parentPath: ".", entries };
}

function feedback(operation: "move" | "copy", label: string): FileDropFeedback {
  return {
    operation,
    valid: true,
    target: { id: "target", kind: "directory", pane: "right", rootId: "root", path: label, label },
  };
}

function entry(name: string): Entry {
  return { name, relativePath: name, type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false };
}
```

Append to `web/src/i18n.test.ts`:

```ts
it("localizes drag summaries, destinations, and invalid targets", () => {
  expect(strings.en.dragSummary("a.txt", 2)).toBe("a.txt and 1 more");
  expect(strings["zh-CN"].dragSummary("a.txt", 2)).toBe("a.txt 等 2 项");
  expect(strings.en.dragDestination("move", "folder")).toBe("move to folder");
  expect(strings["zh-CN"].invalidDrop("inside-source")).toBe("不能将文件夹放入自身或其子文件夹");
});
```

- [ ] **Step 2: Run the focused tests and verify overlay/copy are missing**

```bash
npm test -- --run src/components/FileDragOverlay.test.tsx src/i18n.test.ts
```

Expected: FAIL because the overlay and drag-specific string functions do not exist.

- [ ] **Step 3: Commit the red overlay and localization tests**

```bash
git add web/src/components/FileDragOverlay.test.tsx web/src/i18n.test.ts
git commit -m "test: cover file drag feedback"
```

- [ ] **Step 4: Add exact English and Chinese drag copy**

Add these fields to `UIStrings`:

```ts
dragSummary(name: string, count: number): string;
dragDestination(type: string, target: string): string;
dragStarted(name: string, count: number): string;
dragOver(target: string): string;
dragDropped(target: string): string;
dragCanceled: string;
invalidDrop(reason: string): string;
```

Add to English:

```ts
dragSummary: (name, count) => count === 1 ? name : `${name} and ${count - 1} more`,
dragDestination: (type, target) => `${strings.en.operationType(type)} to ${target}`,
dragStarted: (name, count) => count === 1 ? `Started dragging ${name}` : `Started dragging ${name} and ${count - 1} more`,
dragOver: (target) => `Over ${target}`,
dragDropped: (target) => `Dropped on ${target}`,
dragCanceled: "Drag canceled",
invalidDrop: (reason) => reason === "same-directory"
  ? "The selected items are already in this directory"
  : "A folder cannot be placed inside itself or one of its subfolders",
```

Add to Simplified Chinese:

```ts
dragSummary: (name, count) => count === 1 ? name : `${name} 等 ${count} 项`,
dragDestination: (type, target) => `${strings["zh-CN"].operationType(type)}到${target}`,
dragStarted: (name, count) => count === 1 ? `开始拖动 ${name}` : `开始拖动 ${name} 等 ${count} 项`,
dragOver: (target) => `位于${target}上方`,
dragDropped: (target) => `已放入${target}`,
dragCanceled: "已取消拖动",
invalidDrop: (reason) => reason === "same-directory"
  ? "所选项目已在当前文件夹中"
  : "不能将文件夹放入自身或其子文件夹",
```

- [ ] **Step 5: Implement the compact overlay and `dnd-kit` announcements**

Create `web/src/components/FileDragOverlay.tsx`:

```tsx
import type { Announcements } from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import {
  buildFileDragSource,
  isFileDragData,
  isFileDropData,
  type FileDragSource,
  type FileDropFeedback,
} from "../fileDrag";
import type { UIStrings } from "../i18n";
import { FileIcon } from "./FileIcon";

export function FileDragOverlay({
  source,
  feedback,
  labels,
}: {
  source: FileDragSource;
  feedback: FileDropFeedback | null;
  labels: UIStrings;
}) {
  const first = source.entries[0];
  if (!first) return null;
  return (
    <div
      className="file-drag-overlay"
      data-drop-state={feedback ? (feedback.valid ? "valid" : "invalid") : undefined}
      aria-hidden="true"
    >
      <FileIcon name={first.name} type={first.type} />
      <span className="min-w-0">
        <strong>{labels.dragSummary(first.name, source.entries.length)}</strong>
        {feedback ? <small>{labels.dragDestination(feedback.operation, feedback.target.label)}</small> : null}
      </span>
      {source.entries.length > 1 ? (
        <Badge aria-label={labels.selectionSummary(source.entries.length)}>{source.entries.length}</Badge>
      ) : null}
    </div>
  );
}

export function createFileDragAnnouncements(labels: UIStrings): Announcements {
  return {
    onDragStart({ active }) {
      const data = active.data.current;
      if (!isFileDragData(data)) return undefined;
      const source = buildFileDragSource(data);
      return labels.dragStarted(source.entries[0]?.name ?? data.entry.name, source.entries.length);
    },
    onDragOver({ over }) {
      const target = over?.data.current;
      return isFileDropData(target) ? labels.dragOver(target.label) : undefined;
    },
    onDragEnd({ over }) {
      const target = over?.data.current;
      return isFileDropData(target) ? labels.dragDropped(target.label) : labels.dragCanceled;
    },
    onDragCancel() {
      return labels.dragCanceled;
    },
  };
}
```

- [ ] **Step 6: Add `DndContext`, pointer sensor, and directory-first collision detection to `DualPane`**

Add imports:

```tsx
import { useCallback, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  buildDragRequest,
  buildFileDragSource,
  buildFileDropFeedback,
  isFileDragData,
  isFileDropData,
  type FileDragSource,
  type FileDropFeedback,
} from "../fileDrag";
import { FileDragOverlay, createFileDragAnnouncements } from "./FileDragOverlay";
```

Add component state and sensors:

```tsx
const [dragSource, setDragSource] = useState<FileDragSource | null>(null);
const [dropFeedback, setDropFeedback] = useState<FileDropFeedback | null>(null);
const dragSourceRef = useRef<FileDragSource | null>(null);
const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
```

Add a directory-first collision helper outside `DualPane`:

```tsx
const fileCollisionDetection: CollisionDetection = (args) => {
  const collisions = pointerWithin(args);
  const directory = collisions.find((collision) =>
    args.droppableContainers.get(collision.id)?.data.current?.kind === "directory",
  );
  if (directory) return [directory];
  const pane = collisions.find((collision) =>
    args.droppableContainers.get(collision.id)?.data.current?.kind === "current-directory",
  );
  return pane ? [pane] : [];
};
```

- [ ] **Step 7: Implement drag start, target feedback, cancellation, and preview creation**

Add these handlers inside `DualPane`:

```tsx
function handleFileDragStart(event: DragStartEvent) {
  const data = event.active.data.current;
  if (!isFileDragData(data)) return;
  const source = buildFileDragSource(data);
  dragSourceRef.current = source;
  setDragSource(source);
  setDropFeedback(null);
  setActivePane(source.pane);

  if (!data.selectedPaths.includes(data.entry.relativePath)) {
    updatePane(source.pane, (pane) => ({
      ...pane,
      selected: new Set(source.entries.map((entry) => entry.relativePath)),
    }));
  }
}

function handleFileDragOver(event: DragOverEvent) {
  const source = dragSourceRef.current;
  const target = event.over?.data.current;
  setDropFeedback(source && isFileDropData(target) ? buildFileDropFeedback(source, target) : null);
}

function clearFileDrag() {
  dragSourceRef.current = null;
  setDragSource(null);
  setDropFeedback(null);
}

function handleFileDragEnd(event: DragEndEvent) {
  const source = dragSourceRef.current;
  const target = event.over?.data.current;
  clearFileDrag();
  if (!source || !isFileDropData(target)) return;

  const feedback = buildFileDropFeedback(source, target);
  if (!feedback.valid) {
    toast.error(labels.invalidDrop(feedback.reason ?? "inside-source"));
    return;
  }

  setPreviewState({
    request: buildDragRequest(source, target),
    operationChoices: ["move", "copy"],
  });
}
```

Replace the two navigation callbacks in `paneProps` with:

```tsx
onRootChange: (rootId: string) => {
  clearFileDrag();
  updatePane(which, (current) => ({ ...current, rootId, path: ".", selected: new Set(), visibleOrder: [] }));
},
onPathChange: (path: string) => {
  clearFileDrag();
  updatePane(which, (current) => ({ ...current, path, selected: new Set(), visibleOrder: [] }));
},
```

This makes a navigation or root change invalidate the captured session before state changes.

Update the Sonner mock in `DualPane.test.tsx` to include `error: vi.fn()`, and reset both `toast.success` and `toast.error` in `beforeEach`.

- [ ] **Step 8: Wrap the workspace and pass feedback into both panes**

Wrap `AppShell` and the overlay with one context:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={fileCollisionDetection}
  onDragStart={handleFileDragStart}
  onDragOver={handleFileDragOver}
  onDragEnd={handleFileDragEnd}
  onDragCancel={clearFileDrag}
  accessibility={{ announcements: createFileDragAnnouncements(labels) }}
>
  <AppShell
    labels={labels}
    activeJobCount={activeJobCount}
    onJobsOpen={() => setJobsOpen(true)}
    languageControl={<LanguageSelect value={languageMode} onChange={onLanguageModeChange} labels={labels} />}
  >
    <div className="grid h-full min-h-0 grid-rows-[42px_minmax(0,1fr)] overflow-hidden">
      <ActionToolbar
        actions={actionsFor(activePane)}
        selectedCount={selectionFor(activePane).length}
        labels={labels}
      />
      <section
        className="workspace"
        data-testid="workspace"
        data-active-pane={activePane}
        style={workspaceStyle(leftPanePercent)}
      >
        <FilePane title={labels.leftPane} labels={labels} {...paneProps("left", left)} />
        <div
          className="pane-divider"
          role="separator"
          aria-label={labels.resizePanes}
          aria-orientation="vertical"
          onMouseDown={startPaneResize}
        />
        <FilePane title={labels.rightPane} labels={labels} {...paneProps("right", right)} />
      </section>
    </div>
  </AppShell>
  <DragOverlay dropAnimation={null}>
    {dragSource ? <FileDragOverlay source={dragSource} feedback={dropFeedback} labels={labels} /> : null}
  </DragOverlay>
</DndContext>
```

Pass `dropFeedback` from `paneProps` to each `FilePane`. Render the preview state with its optional operation choices:

```tsx
{previewState ? (
  <OperationPreview
    request={previewState.request}
    operationChoices={previewState.operationChoices}
    labels={labels}
    onClose={() => setPreviewState(null)}
    onJobCreated={(id) => {
      setPreviewState(null);
      handleJobCreated(id);
    }}
  />
) : null}
```

- [ ] **Step 9: Add stable overlay styling**

Append to `web/src/styles.css`:

```css
.file-drag-overlay {
  max-width: 260px;
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border: 1px solid color-mix(in oklab, var(--primary) 55%, var(--border));
  border-radius: 6px;
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 10px 24px color-mix(in oklab, var(--foreground) 18%, transparent);
  cursor: grabbing;
}

.file-drag-overlay strong,
.file-drag-overlay small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.file-drag-overlay small {
  margin-top: 2px;
  color: var(--muted-foreground);
  font-size: 11px;
}

.file-drag-overlay[data-drop-state="invalid"] {
  border-color: var(--destructive);
  cursor: not-allowed;
}
```

- [ ] **Step 10: Run focused drag orchestration regressions**

```bash
npm test -- --run src/fileDrag.test.ts src/components/FileDragOverlay.test.tsx src/components/FilePane.test.tsx src/components/DualPane.test.tsx src/components/OperationPreview.test.tsx src/i18n.test.ts
```

Expected: all focused tests pass; component rendering has no missing Dnd context, act, or accessibility warnings.

- [ ] **Step 11: Commit dual-pane drag coordination**

```bash
git add web/src/components/FileDragOverlay.tsx web/src/components/FileDragOverlay.test.tsx web/src/components/DualPane.tsx web/src/components/DualPane.test.tsx web/src/i18n.ts web/src/i18n.test.ts web/src/styles.css
git commit -m "feat: coordinate dual-pane file dragging"
```

### Task 8: Add Route-Mocked Browser Acceptance Coverage

**Files:**
- Create: `web/e2e/drag-drop-context-menu.spec.ts`
- Modify: `web/playwright.config.ts`
- Modify: `web/.gitignore`
- Test: `web/e2e/drag-drop-context-menu.spec.ts`

- [ ] **Step 1: Make the Playwright base URL selectable without changing its default**

Update `web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8080",
  },
});
```

Append generated Playwright output to `web/.gitignore`:

```gitignore
test-results
playwright-report
```

- [ ] **Step 2: Create deterministic API fixtures and drag acceptance tests**

Create `web/e2e/drag-drop-context-menu.spec.ts`:

```ts
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

type OpsPayload = {
  type: "move" | "copy";
  sourceRoot: string;
  sources: string[];
  destRoot: string;
  destPath: string;
};

test("previews same-pane and cross-pane drops with Windows-style defaults", async ({ page }) => {
  const dryRuns = await installMockApi(page);
  await page.goto("/");
  const left = page.getByRole("region", { name: "Left pane" });
  const right = page.getByRole("region", { name: "Right pane" });
  await expect(entryRow(left, "source.txt")).toBeVisible();
  await expect(entryRow(right, "folder")).toBeVisible();

  const dryRunCount = dryRuns.length;
  await entryRow(left, "folder").dragTo(entryRow(right, "folder"));
  await expect(page.getByText("A folder cannot be placed inside itself or one of its subfolders")).toBeVisible();
  await expect.poll(() => dryRuns.length).toBe(dryRunCount);

  await entryRow(left, "source.txt").dragTo(entryRow(left, "folder"));
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "move", sourceRoot: "data", sources: ["source.txt"], destRoot: "data", destPath: "folder",
  });
  let dialog = page.getByRole("dialog", { name: "move preview" });
  await expect(dialog.getByRole("radio", { name: "move" })).toBeChecked();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await entryRow(left, "source.txt").dragTo(entryRow(right, "folder"));
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "move", sourceRoot: "data", destRoot: "data", destPath: "folder",
  });
  dialog = page.getByRole("dialog", { name: "move preview" });
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await right.getByRole("combobox", { name: "Right pane root" }).selectOption("archive");
  await expect(entryRow(right, "archive.txt")).toBeVisible();
  await entryRow(left, "source.txt").dragTo(entryRow(right, "archive.txt"));
  await expect.poll(() => dryRuns.at(-1)).toMatchObject({
    type: "copy", sourceRoot: "data", destRoot: "archive", destPath: ".",
  });
  dialog = page.getByRole("dialog", { name: "copy preview" });
  await expect(dialog.getByRole("radio", { name: "copy" })).toBeChecked();

  await dialog.getByRole("radio", { name: "move" }).click();
  await expect.poll(() => dryRuns.at(-1)?.type).toBe("move");
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

function entryRow(pane: Locator, name: string) {
  return pane.locator("tbody tr").filter({ hasText: name });
}

async function openBlankContextMenu(fileList: Locator) {
  const box = await fileList.boundingBox();
  if (!box) throw new Error("file list has no bounding box");
  await fileList.dispatchEvent("contextmenu", {
    button: 2,
    clientX: box.x + box.width - 20,
    clientY: box.y + box.height - 20,
  });
}

async function installMockApi(page: Page) {
  const dryRuns: OpsPayload[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "languages", { configurable: true, get: () => ["en-US"] });
  });
  await page.route("**/api/**", async (route) => {
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
    if (url.pathname === "/api/ops/jobs") return respond(route, { id: "job-1" });
    if (url.pathname === "/api/jobs" && request.method() === "GET") return respond(route, []);
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_mocked", message: url.pathname } }),
    });
  });
  return dryRuns;
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
```

- [ ] **Step 3: Start a route-mocked frontend server on a non-loopback interface**

From `web/`, start this in a dedicated terminal session:

```bash
npm run dev -- --host 0.0.0.0 --port 8081
```

Expected: Vite reports `http://localhost:8081` and a network URL. Keep this session running only for Steps 4-6.

- [ ] **Step 4: Run the focused Playwright suite**

From a second `web/` terminal:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8081 npx playwright test e2e/drag-drop-context-menu.spec.ts
```

Expected: both acceptance tests pass in Chromium. If a browser interaction fails, fix the production behavior covered by that assertion and rerun this exact command before committing.

- [ ] **Step 5: Inspect both committed viewport checks**

Inspect `web/test-results/file-context-menu-1440x900.png` and `web/test-results/file-context-menu-1024x768.png`. Confirm the popup remains in the viewport, no labels overlap, and the file table and toolbar retain their fixed dimensions at both sizes. The screenshots remain ignored local evidence and are not committed.

- [ ] **Step 6: Stop the Vite test server**

Send Ctrl-C to the dedicated terminal session and verify port 8081 is no longer listening.

- [ ] **Step 7: Commit the browser acceptance tests**

Do not add ignored screenshot artifacts. Commit only source and configuration:

```bash
git add web/e2e/drag-drop-context-menu.spec.ts web/playwright.config.ts web/.gitignore
git commit -m "test: cover file drag workflows"
```

### Task 9: Run Complete Verification And Inspect The Final Diff

**Files:**
- Verify: `internal/ops/planner.go`
- Verify: `web/src/fileDrag.ts`
- Verify: `web/src/components/DualPane.tsx`
- Verify: `web/src/components/FilePane.tsx`
- Verify: `web/src/components/FileRow.tsx`
- Verify: `web/src/components/PaneContextMenu.tsx`
- Verify: `web/src/components/OperationPreview.tsx`
- Verify: `docs/superpowers/specs/2026-07-26-file-drag-drop-context-menu-design.md`

- [ ] **Step 1: Run all Go tests**

From the repository root:

```bash
go test ./...
```

Expected: every Go package passes with zero failures.

- [ ] **Step 2: Run the complete frontend unit/component suite**

From `web/`:

```bash
npm test -- --run
```

Expected: Vitest exits with code 0, with no failed tests or unhandled promise rejections.

- [ ] **Step 3: Run lint and the type-checked production build**

```bash
npm run lint
npm run build
```

Expected: ESLint reports no errors, TypeScript project compilation succeeds, and Vite produces `web/dist`.

- [ ] **Step 4: Rerun the focused Playwright acceptance suite**

Start Vite on `0.0.0.0:8081`, run:

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8081 npx playwright test e2e/drag-drop-context-menu.spec.ts
```

Expected: both tests pass. Inspect `web/test-results/file-context-menu-1440x900.png` for clipping, overlapping labels, incorrect popup placement, or layout shift, then stop the server and leave port 8081 closed.

- [ ] **Step 5: Check dependency scope, whitespace, and repository state**

From the repository root:

```bash
git diff origin/main...HEAD --check
git status --short
git log --oneline --decorate origin/main..HEAD
```

Expected: no whitespace errors; only the approved source, tests, lock file, spec, and plan are tracked; `.superpowers/`, `web/dist/`, and `web/test-results/` are absent from status; the documented incremental commits are visible above `origin/main`.

- [ ] **Step 6: Review acceptance criteria against the implementation**

Confirm all of these directly in code and tests before reporting completion:

```text
same-pane directory drop -> Move preview
cross-pane equal rootId -> Move preview
cross-pane different rootId -> Copy preview
regular-file or whitespace target -> pane current directory
Move/Copy switch -> fresh dry-run and selected job type
selected-row right click -> preserved multi-selection
unselected-row right click -> single replacement selection
whitespace right click -> eight visible actions, only mkdir enabled
directory into self/descendant -> frontend rejection plus planner conflict
toolbar and context menu -> one shared action descriptor list
```
