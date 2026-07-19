# Compact Path Breadcrumbs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact, single-row breadcrumb that keeps the root, first directory, and current directory visible, preserves the newest ancestors from right to left, and exposes omitted directories through an accessible `…` menu.

**Architecture:** Keep path state and navigation callbacks in `FilePane`, but move path construction and width-independent fitting into a pure `pathSegments` module. `FilePane` measures rendered labels with a `ResizeObserver`, passes widths to the pure helper, and renders explicit separator spans plus Base UI menu controls. CSS fixes the breadcrumb grid track at 29px, keeps the original full-pane span, and supplies matching upper/lower dividers.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, CSS custom properties, `@base-ui/react/menu`, existing shadcn/ui tokens.

---

## File Map

- Create: `web/src/pathSegments.ts` — path segment types, normalization, display-path helpers, and the deterministic right-to-left fitting function.
- Create: `web/src/pathSegments.test.ts` — width-independent fitting tests.
- Create: `web/src/components/ui/menu.tsx` — small styled wrappers around `@base-ui/react/menu` parts used by the overflow control.
- Modify: `web/src/components/FilePane.tsx` — measurement state, visible/hidden segment rendering, explicit separators, and hidden-directory menu navigation.
- Modify: `web/src/components/FilePane.test.tsx` — rendering, click-target, menu, and resize behavior.
- Modify: `web/src/styles.css` — 29px row geometry, matching dividers, pointer/default cursors, and menu styling.
- Modify: `web/src/styles.test.ts` — assertions for row height, overflow behavior, separators, and divider rules.
- Modify: `web/src/i18n.ts` — localized labels for the hidden-segment menu and its accessible name.
- Modify: `web/src/i18n.test.ts` — assertions for the new English and Simplified Chinese count-aware labels.

## Task 1: Specify and Implement the Pure Fitting Helper

**Files:**
- Create: `web/src/pathSegments.test.ts`
- Create: `web/src/pathSegments.ts`

- [ ] **Step 1: Write failing fitting tests**

Add tests that call a pure function with complete segment widths, separator width, ellipsis width, and available width. Use these exact widths in pixels: `[14, 52, 72, 68, 74, 30, 70]` for `/`, `Games`, `Unity翻译`, `Projects`, `FileButler`, `web`, and `components`; use `separatorWidth = 8` and `ellipsisWidth = 24`. Assert:

```ts
expect(fitPathSegments(segments, widths, 8, 24, 900).visible.map((item) => item.label)).toEqual([
  "/", "Games", "Unity翻译", "Projects", "FileButler", "web", "components",
]);

expect(fitPathSegments(segments, widths, 8, 24, 330).visible.map((item) => item.label)).toEqual([
  "/", "Games", "FileButler", "web", "components",
]);
expect(fitPathSegments(segments, widths, 8, 24, 330).hidden.map((item) => item.label)).toEqual([
  "Unity翻译", "Projects",
]);
```

Also cover the exact-fit boundary, root-only paths, one-directory paths, and a narrow width where the fixed root/first/current set is returned without dropping any of those logical items.

- [ ] **Step 2: Run the focused tests and verify the intended failure**

Run: `npm --prefix web test -- --run src/pathSegments.test.ts`

Expected: FAIL because `web/src/pathSegments.ts` and `fitPathSegments` do not exist yet.

- [ ] **Step 3: Implement the pure module**

Define:

```ts
export type PathSegment = { label: string; path: string };
export type FittedPathSegments = { visible: PathSegment[]; hidden: PathSegment[] };

export function displayPath(path: string): string;
export function normalizeInput(path: string): string;
export function buildPathSegments(path: string): PathSegment[];
export function fitPathSegments(
  segments: PathSegment[],
  widths: number[],
  separatorWidth: number,
  ellipsisWidth: number,
  availableWidth: number,
): FittedPathSegments;
```

The fitting implementation must reserve index `0`, index `1` when present, and the final index. If there are hidden middle items, include one ellipsis token and count the separators around it. Try candidates from `segments.length - 2` down to index `2`; keep a candidate only when the complete resulting token row fits. Return hidden items in their original path order. Do not read DOM state or call browser APIs from this module.

- [ ] **Step 4: Run the focused tests and confirm green**

Run: `npm --prefix web test -- --run src/pathSegments.test.ts`

Expected: all fitting cases pass.

## Task 2: Add the Accessible Overflow Menu Primitive

**Files:**
- Create: `web/src/components/ui/menu.tsx`

- [ ] **Step 1: Add wrappers for the Base UI menu parts**

Wrap `Menu.Root`, `Menu.Trigger`, `Menu.Portal`, `Menu.Positioner`, `Menu.Popup`, and `Menu.Item` from `@base-ui/react/menu`. Keep the wrapper API small and style the popup with existing `--popover`, `--border`, `--foreground`, `--accent`, and focus-ring tokens. The item wrapper must expose `onClick`, `data-slot`, focus styling, and a disabled state without changing the Base UI keyboard behavior.

- [ ] **Step 2: Type-check the primitive in isolation**

Run: `npm --prefix web run build`

Expected: the new wrapper compiles without changing runtime behavior elsewhere.

## Task 3: Integrate Measurement and Rendering in `FilePane`

**Files:**
- Modify: `web/src/components/FilePane.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/i18n.test.ts`
- Modify: `web/src/components/FilePane.test.tsx`

- [ ] **Step 1: Add failing component tests for click targets and overflow**

Extend the existing `renderPane` tests with these behaviors:

```ts
it("keeps separators non-interactive", () => {
  renderPane({ currentPath: "photos/2026/raw" });
  const nav = screen.getByRole("navigation", { name: "Left pane segments" });
  expect(within(nav).getAllByRole("button").map((button) => button.textContent)).toEqual(["/", "photos", "2026", "raw"]);
  expect(nav.querySelectorAll(".path-separator")).toHaveLength(3);
});

it("opens hidden directories from the ellipsis menu and navigates to the selected path", async () => {
  const onPathChange = vi.fn();
  const restoreMeasurements = mockBreadcrumbMeasurements({ availableWidth: 220 });
  renderPane({ currentPath: "photos/2026/raw/camera/original", onPathChange });
  const overflow = screen.getByRole("button", { name: /hidden folders/i });
  await userEvent.click(overflow);
  await userEvent.click(screen.getByRole("menuitem", { name: "2026" }));
  expect(onPathChange).toHaveBeenCalledWith("photos/2026");
  restoreMeasurements();
});
```

Define `mockBreadcrumbMeasurements` in the test file to set the breadcrumb container's `clientWidth`, return fixed natural widths for the hidden measurement buttons, and invoke the registered `ResizeObserver` callback once. Assert that the visible buttons contain the root, first directory, retained suffix, and current directory, while the hidden labels appear in the menu.

- [ ] **Step 2: Run the focused component tests and verify the new assertions fail**

Run: `npm --prefix web test -- --run src/components/FilePane.test.tsx`

Expected: FAIL because the current renderer makes every segment a button, has no overflow menu, and has no measured visibility state.

- [ ] **Step 3: Add localized menu labels**

Extend `UIStrings` with this count-aware label:

```ts
hiddenPathSegments(count: number): string;
```

Use the exact English format `Show {count} hidden folders` and Simplified Chinese format `显示 {count} 个隐藏文件夹`. Keep the existing `pathLabel`, `rootLabel`, and refresh labels unchanged.

- [ ] **Step 4: Test the localized labels**

Add to `web/src/i18n.test.ts`:

```ts
import { strings } from "./i18n";

it("formats hidden path segment labels in both supported languages", () => {
  expect(strings.en.hiddenPathSegments(3)).toBe("Show 3 hidden folders");
  expect(strings["zh-CN"].hiddenPathSegments(3)).toBe("显示 3 个隐藏文件夹");
});
```

Run: `npm --prefix web test -- --run src/i18n.test.ts`

Expected: FAIL before the dictionary fields are added, then PASS after both dictionaries implement the same signature.

- [ ] **Step 5: Refactor path helpers and add measurement state**

Import `PathSegment`, `buildPathSegments`, `displayPath`, `normalizeInput`, and `fitPathSegments` from `web/src/pathSegments.ts`. Add refs for the visible breadcrumb container, an offscreen `path-segments-measure` row containing every complete directory label, and the natural widths keyed by segment path. The hidden measurement row must use `position: absolute; visibility: hidden; white-space: nowrap; pointer-events: none` so all labels remain measurable without affecting layout. Add state for the fitted visible/hidden result and a `ResizeObserver` that recomputes after path or container changes. Pass the measured widths to the pure helper. Use `useLayoutEffect` for the first fit and clean up the observer on unmount.

- [ ] **Step 6: Render explicit controls and the menu**

Replace the current `pathSegments.map` block with:

- a root button;
- directory buttons only for fitted visible segments;
- `<span className="path-separator" aria-hidden="true">/</span>` between tokens;
- one `Menu.Trigger` rendered as `…` when `hidden.length > 0`;
- `Menu.Item` entries for hidden segments in path order, each calling `onPathChange(segment.path)`.

Keep the `nav` accessible name unchanged. Give the overflow trigger the localized count-aware label. Ensure clicking a folder button stops only its own navigation event; separators have no event handlers and cannot receive focus.

- [ ] **Step 7: Run the focused component tests and confirm green**

Run: `npm --prefix web test -- --run src/components/FilePane.test.tsx`

Expected: existing path-input and visible-segment tests plus the new overflow/menu/click-target tests pass.

## Task 4: Apply the Compact Geometry and Interaction Styles

**Files:**
- Modify: `web/src/styles.css`
- Modify: `web/src/styles.test.ts`

- [ ] **Step 1: Add failing style assertions**

Assert that `.file-pane` keeps a 29px breadcrumb grid track, `.pane-header` and `.path-segments` use the same border token for the upper and lower dividers, `.path-segments` has no 32px minimum, and `.path-separator` is non-interactive while `.path-segment-button` and the overflow trigger use a pointer cursor. Also assert that `.path-segments-measure` is hidden from layout and pointer interaction.

- [ ] **Step 2: Run the style tests and verify the intended failure**

Run: `npm --prefix web test -- --run src/styles.test.ts`

Expected: FAIL against the current `min-height: 32px` and pseudo-separator implementation.

- [ ] **Step 3: Update the CSS**

Use the existing layout tokens and make the geometry explicit:

```css
.file-pane {
  grid-template-rows: 39px 29px minmax(0, 1fr) 28px;
}

.pane-header {
  min-height: 0;
}

.path-segments {
  min-height: 0;
  height: 29px;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
}

.path-segment-button,
.path-segments [data-slot="menu-trigger"] {
  cursor: pointer;
}

.path-separator {
  cursor: default;
  pointer-events: none;
  user-select: none;
}

.path-segments-measure {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
}
```

Remove the `button + button::before` separator rule. Add compact hover/focus styles and the menu popup/item styles using the existing popover and accent tokens. Do not change the pane's horizontal width or file-table columns.

- [ ] **Step 4: Run style tests and confirm green**

Run: `npm --prefix web test -- --run src/styles.test.ts`

Expected: all style assertions pass.

## Task 5: Full Verification and Visual Check

**Files:**
- Verify: `web/src/pathSegments.ts`
- Verify: `web/src/pathSegments.test.ts`
- Verify: `web/src/components/ui/menu.tsx`
- Verify: `web/src/components/FilePane.tsx`
- Verify: `web/src/components/FilePane.test.tsx`
- Verify: `web/src/styles.css`
- Verify: `web/src/styles.test.ts`
- Verify: `web/src/i18n.ts`
- Verify: `web/src/i18n.test.ts`

- [ ] **Step 1: Run the complete frontend test suite**

Run: `npm --prefix web test -- --run`

Expected: zero failed tests.

- [ ] **Step 2: Run lint and production build**

Run:

```bash
npm --prefix web run lint
npm --prefix web run build
```

Expected: both commands exit with status 0.

- [ ] **Step 3: Exercise the visual states in a browser**

Start the existing frontend dev server and inspect a dual pane at desktop width and a narrow pane. Verify that:

- the row stays one line and 29px high;
- upper and lower dividers are visible and visually identical;
- the current directory remains visible;
- resizing the pane reveals/hides suffix ancestors in the specified order;
- folder names and `…` show a pointer cursor;
- slashes do not show a pointer cursor or respond to clicks;
- the menu lists hidden folders in path order and navigates correctly;
- existing path editing and file-list scrolling remain unchanged.

- [ ] **Step 4: Review the final diff and working tree**

Run: `git diff --check` and `git status --short`. Confirm that only the files in the file map changed and no generated build output is included.
