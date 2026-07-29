# File Selection Interactions Implementation Plan

> **For agentic workers:** Execute each task test-first and keep the existing file-drag activation boundary intact.

**Goal:** Add whole-row click selection, Ctrl toggle selection, Shift range selection, and vertically auto-scrolling marquee selection without regressing icon-and-name file dragging.

**Architecture:** Put deterministic selection transitions in a pure helper owned by `DualPane` state, and put pending-click, marquee, geometry, and animation-frame scrolling in one `FilePane` gesture controller. Keep `FileRow` registered as the full draggable geometry while dnd-kit's activator remains limited to the icon and visible name.

**Tech Stack:** React 19, TypeScript 6, `@dnd-kit/core`, Vitest, Testing Library, Playwright/Chromium.

---

## File Structure

- Create `web/src/fileSelection.ts`: pure single, toggle, and range transitions.
- Create `web/src/fileSelection.test.ts`: deterministic selection and anchor coverage.
- Modify `web/src/components/DualPane.tsx`: store one anchor per pane and apply selection intents atomically.
- Modify `web/src/components/DualPane.test.tsx`: integration coverage for row, Ctrl, and Shift selection.
- Modify `web/src/components/FilePane.tsx`: own pending-click/marquee classification, content-space geometry, live selection, auto-scroll, and cleanup.
- Modify `web/src/components/FilePane.test.tsx`: gesture threshold, auto-scroll, geometry, and cleanup coverage.
- Modify `web/src/components/FileRow.tsx`: expose selected row semantics and a safe non-drag click path from the dnd activator.
- Modify `web/e2e/drag-drop-context-menu.spec.ts`: browser coverage for long-list marquee scrolling and modifier selection while preserving file dragging.

### Task 1: Specify And Implement Selection Transitions

**Files:**
- Create: `web/src/fileSelection.test.ts`
- Create: `web/src/fileSelection.ts`
- Modify: `web/src/components/DualPane.tsx`

- [ ] **Step 1: Write failing pure-helper tests**

Cover these transitions:

- single selection replaces the set and stores the clicked path as anchor;
- toggle adds or removes only the target and stores it as anchor;
- range with no valid anchor falls back to single selection;
- range with a valid anchor selects an inclusive range in either direction;
- repeated ranges preserve the original anchor;
- range follows supplied visible order, including sorted order changes;
- an anchor absent from visible order falls back to single selection.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `web/`:

```bash
npm test -- --run src/fileSelection.test.ts
```

Expected: FAIL because `fileSelection.ts` does not exist.

- [ ] **Step 3: Commit the red helper tests**

```bash
git add web/src/fileSelection.test.ts
git commit -m "test: cover file selection transitions"
```

- [ ] **Step 4: Implement the pure transition helper**

Define a small API returning `{ selected, anchor }` for `single`, `toggle`, and `range`. Clone incoming sets rather than mutating caller-owned state. Preserve the original valid anchor for range operations.

- [ ] **Step 5: Integrate anchor state into both panes**

Extend `PaneState` with `selectionAnchor: string | null`. Initialize and clear it with root/path changes, operation selection clearing, and hidden-entry pruning. Route row intents through the helper using `visibleOrder`. Marquee replacement clears the anchor.

- [ ] **Step 6: Run focused helper and DualPane tests**

```bash
npm test -- --run src/fileSelection.test.ts src/components/DualPane.test.tsx
```

- [ ] **Step 7: Commit the selection model**

```bash
git add web/src/fileSelection.ts web/src/components/DualPane.tsx
git commit -m "feat: add anchored file selection model"
```

### Task 2: Add Whole-Row Click And Modifier Selection

**Files:**
- Modify: `web/src/components/FilePane.test.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/components/FilePane.tsx`
- Modify: `web/src/components/FileRow.tsx`

- [ ] **Step 1: Write failing component and integration tests**

Cover:

- press and release on type, size, modified-time, and unused name-cell space selects only that row;
- movement below 4 pixels remains a click;
- movement at or beyond the marquee threshold becomes a marquee and does not also emit a row click;
- a short click on the icon-and-name activator selects its row;
- a real activator drag does not collapse an existing selected group on release;
- checkbox clicks toggle independently;
- rows expose `aria-selected` matching their selected prop;
- Ctrl-click adds and removes entries;
- Shift-click with no anchor selects one entry, subsequent held-Shift click selects the inclusive range, and a later plain click collapses selection;
- Ctrl+Shift resolves as Shift range selection.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm test -- --run src/components/FilePane.test.tsx src/components/DualPane.test.tsx
```

- [ ] **Step 3: Commit the red interaction tests**

```bash
git add web/src/components/FilePane.test.tsx web/src/components/DualPane.test.tsx
git commit -m "test: cover desktop file selection gestures"
```

- [ ] **Step 4: Implement pending-click versus marquee classification**

Replace the current release-only marquee flow with one controller that records the row path and modifiers at pointer release. Before threshold activation, release emits a single/toggle/range intent. After activation, release cannot emit a row click.

Keep checkboxes, controls, headers, separators, and the dnd activator out of this controller. Whitespace clicks remain no-ops.

- [ ] **Step 5: Add activator click selection without post-drag clicks**

Let `FileRow` emit modifier-aware selection for a non-drag activator click. Track whether dnd-kit activated so the click following a real file drag is consumed. Keep the existing 6-pixel dnd activation distance and full-row drag geometry.

- [ ] **Step 6: Add row accessibility state**

Set `aria-selected` on each file row from its existing `selected` prop without changing checkbox labels or keyboard behavior.

- [ ] **Step 7: Run focused tests and commit the interaction**

```bash
npm test -- --run src/fileSelection.test.ts src/components/FilePane.test.tsx src/components/DualPane.test.tsx
```

```bash
git add web/src/components/FilePane.tsx web/src/components/FileRow.tsx web/src/components/DualPane.tsx
git commit -m "feat: add desktop row selection"
```

### Task 3: Add Live Marquee Auto-Scroll

**Files:**
- Modify: `web/src/components/FilePane.test.tsx`
- Modify: `web/src/components/FilePane.tsx`

- [ ] **Step 1: Write failing geometry and animation tests**

Use mocked list and row geometry plus a controllable `requestAnimationFrame` queue to cover:

- marquee selection emits live path updates as the pointer moves;
- identical path lists are not emitted repeatedly;
- holding near the bottom edge increases `scrollTop` and selects rows below the initial viewport;
- holding near the top edge decreases `scrollTop` and recomputes the selected range;
- scrolling stops at zero and maximum `scrollTop`;
- leaving the edge band stops automatic movement;
- mouse release, window blur, and unmount cancel the frame and document listeners;
- marquee coordinates remain stable after `scrollTop` changes.

- [ ] **Step 2: Run FilePane tests and verify RED**

```bash
npm test -- --run src/components/FilePane.test.tsx
```

- [ ] **Step 3: Commit the red auto-scroll tests**

```bash
git add web/src/components/FilePane.test.tsx
git commit -m "test: cover marquee selection auto-scroll"
```

- [ ] **Step 4: Convert marquee geometry to list-content coordinates**

Store the gesture start and current pointer relative to the list content. Convert row rectangles into the same coordinate space using current scroll offsets before positive-area intersection checks. Continue widening row hit rectangles to the list viewport as the existing marquee does.

- [ ] **Step 5: Implement edge-driven animation**

Use an edge band approximately one compact row high. Calculate capped vertical velocity from pointer position, clamp `scrollTop`, and recompute the box and selected paths after effective scroll movement. Schedule frames only while scrolling can continue.

- [ ] **Step 6: Implement centralized cleanup**

One idempotent cleanup path removes global listeners, cancels the current animation frame, and clears gesture/box state for release, blur, navigation, and unmount.

- [ ] **Step 7: Run focused tests and commit auto-scroll**

```bash
npm test -- --run src/components/FilePane.test.tsx
```

```bash
git add web/src/components/FilePane.tsx
git commit -m "feat: auto-scroll marquee selection"
```

### Task 4: Verify Real Browser Behavior And Regressions

**Files:**
- Modify: `web/e2e/drag-drop-context-menu.spec.ts`

- [ ] **Step 1: Extend the mock directory with enough ordered entries to overflow one pane**

Keep existing named drag/drop fixtures stable and append deterministic entries for long-list selection.

- [ ] **Step 2: Add browser selection coverage**

Verify:

- plain row click selects one entry;
- Ctrl-click toggles additional entries;
- first Shift-click without an anchor selects one entry;
- a second Shift-click while Shift remains held selects the inclusive range;
- releasing Shift and clicking normally collapses the selection;
- bottom-edge marquee scrolling increases the list's `scrollTop` and selects an initially off-screen row;
- icon-and-name file drag still opens the correct operation preview and preserves selected-group behavior.

- [ ] **Step 3: Run focused Playwright tests**

```bash
npx playwright test e2e/drag-drop-context-menu.spec.ts
```

- [ ] **Step 4: Commit browser coverage**

```bash
git add web/e2e/drag-drop-context-menu.spec.ts
git commit -m "test: cover scrolling file selection workflow"
```

### Task 5: Complete Verification

- [ ] **Step 1: Run all frontend tests**

```bash
npm test -- --run
```

- [ ] **Step 2: Run lint and production build**

```bash
npm run lint
npm run build
```

- [ ] **Step 3: Run backend regression tests**

```bash
go test ./...
```

- [ ] **Step 4: Run complete Playwright coverage against a fresh test environment**

```bash
npx playwright test
```

- [ ] **Step 5: Inspect final diff and repository state**

Confirm every acceptance criterion, no unrelated file changes, no leaked test process, and a clean working tree.
