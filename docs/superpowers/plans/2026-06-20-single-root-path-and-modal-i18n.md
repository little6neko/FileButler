# Single Root Path And Modal I18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement single-root `/` presentation, clickable path segments, opposite-pane operation destinations, visible active pane framing, and localized dialogs.

**Architecture:** Keep backend contracts unchanged. Update frontend component props and tests so `DualPane` coordinates pane state and shared labels while `FilePane`, `OperationPreview`, `RenameDialog`, and `JobsPanel` render localized controlled UI.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: File Pane Single Root And Clickable Path

- [ ] Add failing FilePane tests for hiding single root selector and clicking path segments.
- [ ] Implement single-root `/` marker and path segment buttons.
- [ ] Verify FilePane tests pass.

### Task 2: Operation Direction And Active Pane

- [ ] Add failing DualPane tests for opposite-pane destination payload and active pane visual state.
- [ ] Implement active pane class/label and ensure operation payload uses opposite pane path.
- [ ] Verify DualPane tests pass.

### Task 3: Dialog Localization

- [ ] Add failing tests for Chinese labels in OperationPreview, RenameDialog, and JobsPanel.
- [ ] Extend `UIStrings` and pass labels into all dialogs.
- [ ] Verify frontend tests and build pass.

### Task 4: Local Test Server Config

- [ ] Update `/tmp/filebutler-test` to a single mapped root and rebuild/restart the local server.
- [ ] Verify browser behavior manually with Playwright.
