# File Table Sorting Resize And PowerRename Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add continuous file table separators, resizable/sortable file pane columns, sorted PowerRename input order, and PowerRename matched-row highlighting.

**Architecture:** Keep the existing `FilePane`, `DualPane`, and `RenameDialog` components. `FilePane` owns per-pane sort and column width state and emits visible order to `DualPane`; `DualPane` uses that order for active selections. `RenameDialog` highlights rows based on `PlanItem.changed`.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS.

---

## File Structure

- Modify `web/src/components/FilePane.tsx`: sort state, column widths, resize handles, visible order callback.
- Modify `web/src/components/DualPane.tsx`: store visible order per pane and return selected paths in that order.
- Modify `web/src/components/RenameDialog.tsx`: add highlight class for changed preview rows.
- Modify tests beside those components.
- Modify `web/src/styles.css`: collapsed table borders, fixed layout, resize handles, sort button styling, matched-row highlight.

## Task 1: File Pane Sorting And Resize

- [ ] Add failing `FilePane` tests for sorting by name and changing column width through the resize handle.
- [ ] Implement local `sortState`, sorted entries, `onVisibleOrderChange`, column width state, and pointer-based resize handling.
- [ ] Verify `npm --prefix web run test -- --run src/components/FilePane.test.tsx`.

## Task 2: PowerRename Uses Visible Selection Order

- [ ] Add failing `DualPane` test where sorted visible order differs from API input order and PowerRename receives sorted selected paths.
- [ ] Store visible order in pane state and make `activeSelection()` return selected paths in visible order.
- [ ] Verify `npm --prefix web run test -- --run src/components/DualPane.test.tsx`.

## Task 3: PowerRename Matched Row Highlight

- [ ] Add failing `RenameDialog` test for changed preview rows having a highlight class.
- [ ] Add row class when `item.changed` is true and style it.
- [ ] Verify `npm --prefix web run test -- --run src/components/RenameDialog.test.tsx`.

## Task 4: Full Verification And Local Server

- [ ] Run `npm --prefix web run test -- --run`.
- [ ] Run `npm --prefix web run build`.
- [ ] Restart `go run ./cmd/filebutler -config /tmp/filebutler-test/filebutler.yaml` on `0.0.0.0:8080`.
- [ ] Browser-check the table renders, PowerRename opens, and changed preview rows are highlighted.
