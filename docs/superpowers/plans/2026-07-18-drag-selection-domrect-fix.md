# Drag Selection DOMRect Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make drag selection choose every file row with positive-area marquee overlap in real browsers while excluding edge-only contact.

**Architecture:** Keep `FilePane`'s existing mouse lifecycle and selection callback. Convert each native row `DOMRect` into an explicit plain rectangle before widening it to the file-list viewport, avoiding object spread over non-enumerable browser geometry properties.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright/Chromium

---

### Task 1: Reproduce Browser Geometry in the Component Test

**Files:**
- Modify: `web/src/components/FilePane.test.tsx:222`
- Test: `web/src/components/FilePane.test.tsx`

- [x] **Step 1: Make the rectangle fixture browser-accurate**

Replace the plain-object `mockRect` return value with a native `DOMRect`, whose coordinate getters are non-enumerable just as they are in Chromium:

```tsx
function mockRect(element: Element, rect: Omit<DOMRect, "toJSON" | "x" | "y"> & Partial<Pick<DOMRect, "x" | "y">>) {
  const browserRect = new DOMRect(rect.x ?? rect.left, rect.y ?? rect.top, rect.width, rect.height);
  element.getBoundingClientRect = vi.fn(() => browserRect);
}
```

- [x] **Step 2: Lock in positive-overlap and edge-only behavior**

Use browser-accurate rectangles in the existing marquee test, and add a focused case where the marquee overlaps the first row but only touches the next row:

```tsx
it("excludes a row that only touches the drag marquee edge", () => {
  const onSelectPaths = vi.fn();
  const { container } = renderPane({ entries: [entry("a.txt"), entry("b.txt")], onSelectPaths });
  const fileList = container.querySelector(".file-list") as HTMLDivElement;
  const rows = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row");
  mockRect(fileList, { left: 0, top: 0, right: 400, bottom: 160, width: 400, height: 160 });
  mockRect(rows[0], { left: 0, top: 32, right: 376, bottom: 64, width: 376, height: 32 });
  mockRect(rows[1], { left: 0, top: 94, right: 376, bottom: 126, width: 376, height: 32 });

  fireEvent.mouseDown(fileList, { button: 0, clientX: 376, clientY: 36 });
  fireEvent.mouseMove(document, { clientX: 380, clientY: 94 });
  fireEvent.mouseUp(document);

  expect(onSelectPaths).toHaveBeenCalledWith(["a.txt"]);
});
```

- [x] **Step 3: Run the focused tests and verify RED**

Run: `npm test -- --run src/components/FilePane.test.tsx`

Expected: FAIL because spreading a native `DOMRect` drops `top` and `bottom`, so `onSelectPaths` receives an empty array.

### Task 2: Preserve Native Rectangle Coordinates Explicitly

**Files:**
- Modify: `web/src/components/FilePane.tsx:364`
- Test: `web/src/components/FilePane.test.tsx`

- [x] **Step 1: Build the row hit rectangle from explicit coordinates**

Replace the `DOMRect` spread in `pathsInsideSelection` with explicit edge reads:

```tsx
const rowRect = row.getBoundingClientRect();
return rectsIntersect(selectionRect, {
  left: listRect?.left ?? rowRect.left,
  top: rowRect.top,
  right: listRect?.right ?? rowRect.right,
  bottom: rowRect.bottom,
});
```

- [x] **Step 2: Run the focused tests and verify GREEN**

Run: `npm test -- --run src/components/FilePane.test.tsx`

Expected: PASS, including positive overlap and edge-only exclusion.

- [x] **Step 3: Run repository verification**

Run: `npm test -- --run`

Expected: all frontend tests pass.

Run: `npm run lint`

Expected: ESLint exits successfully with no errors.

Run: `npm run build`

Expected: TypeScript and Vite build successfully.

Run: `go test ./...`

Expected: all Go packages pass.

- [x] **Step 4: Verify the interaction in Chromium**

Open the running FileButler instance, drag a marquee with positive-area overlap over a row, release it, and verify that the row checkbox becomes checked. Repeat with a marquee that ends at the row boundary and verify that edge-only contact stays unchecked.

- [x] **Step 5: Leave the verified fix uncommitted unless a commit is requested**

No commit was requested, so keep the verified files in the working tree for review.
