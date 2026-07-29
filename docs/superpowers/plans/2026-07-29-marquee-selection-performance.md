# Marquee Selection Performance Implementation Plan

**Goal:** Keep live marquee selection smooth with large file lists while preserving every existing selection, auto-scroll, and file-drag behavior.

**Architecture:** Coalesce marquee work into one animation-frame controller, snapshot row geometry once per gesture, isolate the marquee rectangle from FilePane rendering, memoize stable FileRow inputs, and resolve selected drag groups from the latest DualPane state instead of copying selection arrays into every row.

**Tech Stack:** React 19, TypeScript 6, @dnd-kit/core, Vitest, Testing Library, Playwright/Chromium.

---

## File Structure

- Modify web/src/components/FilePane.tsx: frame scheduling, geometry snapshots, isolated marquee box, and stable row callbacks.
- Modify web/src/components/FilePane.test.tsx: frame coalescing, one-time layout reads, auto-scroll, and cleanup coverage.
- Modify web/src/components/FileRow.tsx: memoization and locally memoized lean drag metadata.
- Modify web/src/components/DualPane.tsx: resolve drag sources from current pane selection and visible order.
- Modify web/src/fileDrag.ts: remove copied selection arrays from FileDragData and accept current selection when building a source.
- Modify web/src/fileDrag.test.ts: preserve selected-group and unselected-entry drag semantics with the lean payload.

## Task 1: Lock In Frame And Geometry Performance

- Add a controllable animation-frame test proving multiple mousemove events are coalesced and the latest pointer wins.
- Add spies proving list and row rectangles are captured at activation and row rectangles are not reread during later pointer or auto-scroll frames.
- Adapt existing marquee tests to advance the scheduled frame while preserving threshold, positive-overlap, edge-only, duplicate-emission, and cleanup expectations.
- Run the focused FilePane test and verify the new performance assertions fail against the current implementation.

## Task 2: Implement The Marquee Frame Controller

- Replace immediate mousemove selection work and the separate auto-scroll loop with one requestAnimationFrame scheduler.
- Snapshot list and row geometry into plain list-content-coordinate records when the gesture crosses 4 pixels.
- Hit-test only the cached records and emit only changed ordered path lists.
- Keep one frame scheduled while edge auto-scroll can continue; stop at boundaries and on pointer return to the center.
- Centralize release, blur, navigation, and unmount cleanup.
- Run focused FilePane tests until green.

## Task 3: Isolate Marquee And Row Rendering

- Move the marquee rectangle behind an imperative child handle so per-frame position changes do not rerender FilePane or its rows.
- Add stable event proxies for row toggle, selection, and open behavior.
- Memoize FileRow with behavior-relevant props while retaining live selected, label, root, path, entry, and drop-feedback inputs.
- Add or adjust focused tests for live checkbox, aria-selected, count, byte total, rectangle lifecycle, and unchanged-row rendering.
- Run focused FilePane and DualPane tests until green.

## Task 4: Remove Per-Row Selection Copies From Drag Data

- Make FileDragData carry only pane, root, parent path, and activated entry data.
- Change buildFileDragSource to receive the latest selected set and visible entries explicitly.
- Resolve those values from the correct current PaneState in DualPane when a drag starts.
- Construct stable drag metadata inside FileRow and remove Array.from(selectedPaths) from the row map.
- Update file-drag tests for selected-group order and unselected-entry behavior, then run focused drag and DualPane tests.

## Task 5: Complete Verification

- Run the complete frontend Vitest suite.
- Run ESLint and the type-checked production frontend build.
- Run all backend Go tests.
- Run relevant Playwright selection and drag/drop coverage.
- Rebuild the frontend served by the existing 0.0.0.0:8082 test service and manually verify the 260-entry temporary fixture.
- Inspect the final diff for unrelated changes and confirm the test server remains running.
