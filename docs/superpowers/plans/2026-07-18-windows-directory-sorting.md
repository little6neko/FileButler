# Windows-Style Directory Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group directories before non-directories for every file-pane sort except descending name order, where non-directories come first.

**Architecture:** Keep sorting inside `FilePane`. Add a directory-group comparison ahead of the existing column comparison, then apply the current ascending/descending direction only within entries belonging to the same group.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright/Chromium

---

### Task 1: Specify Windows-Style Group Ordering

**Files:**
- Modify: `web/src/components/FilePane.test.tsx:146-165`
- Test: `web/src/components/FilePane.test.tsx`

- [x] **Step 1: Update ascending sort expectations and cover non-directory types**

Replace the existing ascending size and default name tests with browser-visible expectations that put directories first. Include `symlink` and `other` in the default name test so they are explicitly treated as non-directories:

```tsx
it("sorts visible entries when clicking a column header", async () => {
  renderPane({
    entries: [entry("b.txt", "file", 2), entry("a.txt", "file", 1), entry("folder", "directory", 0)],
  });

  await userEvent.click(screen.getByRole("button", { name: "Size" }));

  expect(visibleEntryNames()).toEqual(["folder", "a.txt", "b.txt"]);
});

it("sorts by name ascending with directories first by default", () => {
  renderPane({
    entries: [entry("b.txt"), entry("a-link", "symlink"), entry("c-other", "other"), entry("folder", "directory")],
  });

  expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "ascending");
  expect(visibleEntryNames()).toEqual(["folder", "a-link", "b.txt", "c-other"]);
});
```

Add this focused test helper near the existing `renderPane` and `mockRect` helpers:

```tsx
function visibleEntryNames() {
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  return rows.map((row) => within(row).getAllByRole("cell")[1].textContent);
}
```

- [x] **Step 2: Add the descending-name exception test**

```tsx
it("puts non-directories first when sorting names from Z to A", async () => {
  renderPane({
    entries: [
      entry("b-file"),
      entry("y-link", "symlink"),
      entry("m-other", "other"),
      entry("a-folder", "directory"),
      entry("z-folder", "directory"),
    ],
  });

  await userEvent.click(screen.getByRole("button", { name: "Name" }));

  expect(visibleEntryNames()).toEqual(["y-link", "m-other", "b-file", "z-folder", "a-folder"]);
});
```

- [x] **Step 3: Add a descending non-name test**

```tsx
it("keeps directories first when sorting another column descending", async () => {
  renderPane({
    entries: [
      entry("file-small", "file", 2),
      entry("dir-small", "directory", 1),
      entry("file-large", "file", 10),
      entry("dir-large", "directory", 9),
    ],
  });

  await userEvent.click(screen.getByRole("button", { name: "Size" }));
  await userEvent.click(screen.getByRole("button", { name: "Size" }));

  expect(visibleEntryNames()).toEqual(["dir-large", "dir-small", "file-large", "file-small"]);
});
```

- [x] **Step 4: Run the focused test and verify RED**

Run: `npm test -- --run src/components/FilePane.test.tsx`

Expected: FAIL because the current comparator mixes directories and non-directories solely by the active column value.

### Task 2: Add Directory Group Comparison

**Files:**
- Modify: `web/src/components/FilePane.tsx:418-435`
- Test: `web/src/components/FilePane.test.tsx`

- [x] **Step 1: Apply group order before column order**

Replace `sortEntries` with:

```tsx
function sortEntries(entries: Entry[], sortState: SortState) {
  if (!sortState) return entries;
  const direction = sortState.direction === "asc" ? 1 : -1;
  return [...entries].sort((a, b) => {
    const groupOrder = compareEntryGroups(a, b, sortState);
    return groupOrder || compareEntries(a, b, sortState.column) * direction;
  });
}
```

- [x] **Step 2: Implement the Windows-style group comparator**

Add immediately after `sortEntries`:

```tsx
function compareEntryGroups(a: Entry, b: Entry, sortState: NonNullable<SortState>) {
  const aIsDirectory = a.type === "directory";
  const bIsDirectory = b.type === "directory";
  if (aIsDirectory === bIsDirectory) return 0;

  const nonDirectoriesFirst = sortState.column === "name" && sortState.direction === "desc";
  if (nonDirectoriesFirst) return aIsDirectory ? 1 : -1;
  return aIsDirectory ? -1 : 1;
}
```

- [x] **Step 3: Run the focused test and verify GREEN**

Run: `npm test -- --run src/components/FilePane.test.tsx`

Expected: PASS with all `FilePane` tests green.

- [x] **Step 4: Review the diff for scope and consistency**

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.

Run: `git diff -- web/src/components/FilePane.tsx web/src/components/FilePane.test.tsx`

Expected: only the existing drag-selection fix plus the approved sorting comparator and sorting tests are present.

### Task 3: Verify the Complete Application

**Files:**
- Verify: `web/src/components/FilePane.tsx`
- Verify: `web/src/components/FilePane.test.tsx`

- [x] **Step 1: Run all frontend tests**

Run: `npm test -- --run`

Expected: all frontend test files and tests pass.

- [x] **Step 2: Run frontend static checks and production build**

Run: `npm run lint`

Expected: ESLint exits with code 0 and no errors.

Run: `npm run build`

Expected: TypeScript and Vite complete successfully.

- [x] **Step 3: Run all Go tests**

Run: `go test ./...`

Expected: all Go packages pass; the environment may print its existing GOPATH/GOROOT warning.

- [x] **Step 4: Verify group order in Chromium**

Load the rebuilt application from the running local FileButler server. In a pane containing both directories and files, verify that the initial Name A-to-Z view begins with directories. Click Name once and verify that the Name Z-to-A view begins with non-directories. Click Size twice and verify that directories remain before non-directories in descending size order.

- [x] **Step 5: Preserve the working tree for review**

Do not create a code commit unless requested. `FilePane.tsx` and `FilePane.test.tsx` already contain the separate uncommitted drag-selection fix, so committing the full files would combine two changes.
