# Windows-Style Selection Performance Implementation Plan

**Goal:** Eliminate the remaining full-list render cascade during live marquee selection for 260- and 1,000-entry panes without changing UI or interaction behavior.

**Architecture:** Stabilize every dnd-kit input that currently changes with selection, retain memoized rows, reduce cached marquee hit testing to an ordered interval, and move the marquee box on a contained compositor layer. Measure Phase One against explicit browser metrics and introduce a pane-local Selection Store only if those metrics remain outside the approved gate.

**Tech Stack:** React 19, TypeScript 6, @dnd-kit/core, Base UI Checkbox, Vitest, Testing Library, Playwright/Chromium.

---

## Task 1: Lock In The Drag-Context Regression

- Extend the long-list Playwright fixture with a deterministic selection-only scenario.
- Observe name and type attribute mutations on hidden checkbox inputs in both panes.
- Select one row and assert that unchanged checkboxes and the inactive pane receive no hidden-input mutations.
- Run the focused browser test against the current code and verify it fails with pane-wide mutations.

## Task 2: Stabilize dnd-kit Inputs

- Move PointerSensor options to a module-level immutable constant.
- Keep latest left and right PaneState values in commit-synchronized refs.
- Convert drag-source resolution to a stable callback that reads those refs.
- Memoize file-drag announcements and the DndContext accessibility object.
- Keep drag-start selection and selected-group ordering based on the same latest snapshots.
- Run focused FilePane, DualPane, file-drag, and browser mutation tests until green.

## Task 3: Bound Remaining Marquee Work

- Add focused tests for ordered cached-row hit testing in forward and reverse directions, with row gaps and edge-only contact.
- Replace full geometry filter/map work with horizontal rejection plus binary searches for the first and final intersecting rows.
- Compute selected count, selected bytes, and select-all state in one visible-entry pass.
- Position the marquee box with translate3d from a fixed origin and add paint/layout containment without changing its border, fill, size, or stacking.
- Run focused component and browser selection tests.

## Task 4: Apply The Performance Gate

- Profile box-only, cross-row, and edge-auto-scroll gestures with 260 entries.
- Repeat the same scenarios with 1,000 entries.
- Record P95 and P99 frame intervals, frames above 32 ms, script/layout duration, checkbox mutation categories, selected counts, and row rectangle reads.
- Confirm P95 is approximately 20 ms or lower, frames above 32 ms are at most 2 percent, unchanged checkbox inputs are untouched, and each row rectangle is read once per gesture.
- Stop after Phase One if the gate passes.

## Task 5: Implement Pane Selection Store Only If Required

- If Phase One misses the gate, add a stable store per pane for selected paths, Shift anchor, visible order, path subscriptions, and summary subscriptions.
- Route existing single, toggle, range, marquee, select-all, clear, pruning, context-menu, and drag-source reads through the store.
- Subscribe each FileRow only to its own selected bit and subscribe status/toolbar consumers to the summary snapshot.
- Add pure store tests for symmetric-difference notifications, anchors, summaries, pruning, and cleanup.
- Repeat the complete performance gate and stop only when it passes.

## Task 6: Complete Regression Verification

- Run the complete Vitest suite.
- Run ESLint and the type-checked production build.
- Run all backend Go tests.
- Run the complete Playwright suite against a fresh database.
- Confirm the 0.0.0.0:8082 test server serves the rebuilt frontend and remains healthy.
- Inspect the final diff for unrelated changes and leave implementation code uncommitted unless requested.
