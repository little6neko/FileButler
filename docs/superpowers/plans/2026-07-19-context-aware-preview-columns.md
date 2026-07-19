# Context-Aware Preview Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the path columns that are meaningful for each PowerRename and file-operation preview.

**Architecture:** Keep all preview data and API payloads unchanged. `RenameDialog` will remove its source-path presentation, while `OperationPreview` will derive source/destination visibility from `request.type` and render matching table headers and cells conditionally. Existing formatting helpers, status handling, and confirmation flow remain shared.

**Tech Stack:** React 19, TypeScript, Testing Library, Vitest, existing shadcn table components and localized `UIStrings`.

---

### Task 1: Remove the PowerRename Source Column

**Files:**
- Modify: `web/src/components/RenameDialog.tsx:151-170`
- Test: `web/src/components/RenameDialog.test.tsx`

- [ ] **Step 1: Write the failing preview-column test**

Add this test after the existing PowerRename rendering tests. Use a source path that differs from the old name so the assertion proves the path cell is gone rather than merely duplicated by the old-name cell:

```tsx
it("omits the source column from the PowerRename live preview", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "photos/file.txt", oldName: "file.txt", newName: "photo.txt", conflict: false }],
  });
  render(<RenameDialog rootId="data" paths={["photos/file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("columnheader", { name: "Old" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "New" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Source" })).not.toBeInTheDocument();
  expect(screen.queryByText("photos/file.txt", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByText("file.txt", { exact: true })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run:

```bash
npm --prefix web test -- --run src/components/RenameDialog.test.tsx -t "omits the source column"
```

Expected: FAIL because the current dialog still renders the `Source` header and `sourcePath` cell.

- [ ] **Step 3: Remove only the source presentation**

In `RenameDialog.tsx`, delete the first preview `TableHead` and the first preview `TableCell`. Keep `item.sourcePath` in the row key and leave the old-name, new-name, status, conflict, and changed-row logic unchanged. The resulting table body shape is:

```tsx
<TableHeader>
  <TableRow>
    <TableHead className="h-8 text-xs">{labels.old}</TableHead>
    <TableHead className="h-8 text-xs">{labels.new}</TableHead>
    <TableHead className="h-8 text-xs">{labels.status}</TableHead>
  </TableRow>
</TableHeader>
<TableBody>
  {items.map((item) => (
    <TableRow key={item.sourcePath} className={item.changed ? "bg-blue-50" : undefined}>
      <TableCell className="py-1.5 text-xs">{item.oldName}</TableCell>
      <TableCell className={item.changed ? "py-1.5 text-xs font-medium text-blue-700" : "py-1.5 text-xs"}>{item.newName}</TableCell>
      <TableCell className={item.conflict ? "py-1.5 text-xs text-destructive" : "py-1.5 text-xs text-emerald-700"}>
        {item.conflict ? item.errorText || item.errorCode : labels.ready}
      </TableCell>
    </TableRow>
  ))}
</TableBody>
```

- [ ] **Step 4: Run the focused RenameDialog tests**

Run:

```bash
npm --prefix web test -- --run src/components/RenameDialog.test.tsx
```

Expected: all RenameDialog tests pass, including the new no-source-column assertion.

- [ ] **Step 5: Commit the focused change**

```bash
git add web/src/components/RenameDialog.tsx web/src/components/RenameDialog.test.tsx
git commit -m "fix: simplify PowerRename preview columns"
```

### Task 2: Make Operation Preview Columns Match the Operation

**Files:**
- Modify: `web/src/components/OperationPreview.tsx:64-122`
- Test: `web/src/components/OperationPreview.test.tsx`

- [ ] **Step 1: Add failing tests for mkdir, delete, and copy column sets**

Add these tests after the existing localized-label test. They use the real `OperationPreview` component and mocked dry-run responses:

```tsx
it("omits the source column when previewing a new directory", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "", destPath: "new-folder", conflict: false }],
  });
  render(
    <OperationPreview
      request={{ type: "mkdir", sourceRoot: "root", sources: [], destRoot: "root", destPath: "new-folder" }}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("columnheader", { name: "Destination" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Source" })).not.toBeInTheDocument();
});

it("omits the destination column when previewing deletion", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "old.txt", conflict: false }],
  });
  render(
    <OperationPreview
      request={{ type: "delete", sourceRoot: "root", sources: ["old.txt"] }}
      onJobCreated={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByRole("columnheader", { name: "Source" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Destination" })).not.toBeInTheDocument();
});

it("keeps both path columns for copy previews", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "old.txt", destPath: "copy/old.txt", conflict: false }],
  });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(await screen.findByRole("columnheader", { name: "Source" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Destination" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify the intended failure**

Run:

```bash
npm --prefix web test -- --run src/components/OperationPreview.test.tsx -t "column"
```

Expected: the mkdir and delete tests fail because the current table always renders all three columns; the copy test documents the unchanged behavior.

- [ ] **Step 3: Add operation-derived display flags**

Immediately before the `return` in `OperationPreview`, add:

```tsx
const showSourceColumn = request.type !== "mkdir";
const showDestinationColumn = request.type !== "delete";
```

- [ ] **Step 4: Render matching headers and cells conditionally**

Replace the fixed three-column header and row cells with matching conditional fragments:

```tsx
<TableHeader>
  <TableRow>
    {showSourceColumn ? <TableHead>{labels.source}</TableHead> : null}
    {showDestinationColumn ? <TableHead>{labels.destination}</TableHead> : null}
    <TableHead>{labels.status}</TableHead>
  </TableRow>
</TableHeader>
<TableBody>
  {items.map((item) => (
    <TableRow key={`${item.sourcePath}-${item.destPath ?? item.targetPath ?? ""}`}>
      {showSourceColumn ? <TableCell>{displaySource(item, request)}</TableCell> : null}
      {showDestinationColumn ? <TableCell>{displayDestination(item, request)}</TableCell> : null}
      <TableCell className={item.conflict ? "text-destructive" : "text-emerald-700"}>
        {item.conflict ? item.errorText || item.errorCode : labels.ready}
      </TableCell>
    </TableRow>
  ))}
</TableBody>
```

Do not change `displaySource`, `displayDestination`, `itemCount`, loading, conflict, warning, or submission logic.

- [ ] **Step 5: Run the focused OperationPreview tests**

Run:

```bash
npm --prefix web test -- --run src/components/OperationPreview.test.tsx
```

Expected: all existing and new tests pass, including Chinese headers and source/destination root formatting.

- [ ] **Step 6: Commit the operation-specific change**

```bash
git add web/src/components/OperationPreview.tsx web/src/components/OperationPreview.test.tsx
git commit -m "fix: tailor operation preview columns"
```

### Task 3: Full Verification and Review

**Files:**
- Verify: `web/src/components/RenameDialog.tsx`
- Verify: `web/src/components/RenameDialog.test.tsx`
- Verify: `web/src/components/OperationPreview.tsx`
- Verify: `web/src/components/OperationPreview.test.tsx`
- Verify: `docs/superpowers/specs/2026-07-19-context-aware-preview-columns-design.md`

- [ ] **Step 1: Run the complete frontend test suite**

Run:

```bash
npm --prefix web test -- --run
```

Expected: all test files pass with zero failures.

- [ ] **Step 2: Run lint and production build**

Run:

```bash
npm --prefix web run lint
npm --prefix web run build
```

Expected: both commands exit with status 0.

- [ ] **Step 3: Run the repository Go tests**

Run:

```bash
go test ./...
```

Expected: all Go packages pass; no backend files should be changed by this feature.

- [ ] **Step 4: Review the rendered column combinations**

Use the existing component tests as the acceptance matrix:

| Operation | Expected headers |
| --- | --- |
| PowerRename | Old, New, Status |
| mkdir | Destination, Status |
| delete | Source, Status |
| copy | Source, Destination, Status |

Confirm that each header has the same number/order of body cells and that no API request payload changed.

- [ ] **Step 5: Check the final diff and worktree**

Run:

```bash
git diff --check
git status --short
```

Expected: only the two component/test pairs are implementation changes; the design and plan documents are present, with no generated build output.

- [ ] **Step 6: Commit any remaining implementation changes**

If the task commits above were created exactly as specified, no additional commit is needed. If a test-only correction was required during verification, commit it with:

```bash
git add web/src/components/RenameDialog.test.tsx web/src/components/OperationPreview.test.tsx
git commit -m "test: cover context-aware preview columns"
```
