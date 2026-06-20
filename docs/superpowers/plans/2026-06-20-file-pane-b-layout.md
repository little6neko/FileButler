# File Pane B Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved B file-pane layout with path input autocomplete, fixed rows, select-all, and English/Simplified Chinese language selection.

**Architecture:** Keep state ownership in `DualPane`; make `FilePane` a controlled view with local path-input draft state. Add a lightweight `i18n` module and pass translated labels down through props.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS.

---

### Task 1: File Pane Path Input, Select-All, And Fixed Rows

**Files:**
- Modify: `web/src/components/FilePane.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/FilePane.test.tsx`
- Modify: `web/src/styles.css`

- [ ] Write failing tests for select-all, path input Enter navigation, and ArrowDown/Enter directory suggestion navigation.
- [ ] Implement `onSelectAll(checked: boolean)` in `FilePane` and `DualPane`.
- [ ] Replace breadcrumbs with root selector plus path input and suggestions derived from visible directory entries.
- [ ] Wrap the file table in a scroll viewport so rows remain fixed height and empty space remains below the table.
- [ ] Run `npm --prefix web run test -- --run`.

### Task 2: Language Auto/Manual Selection

**Files:**
- Create: `web/src/i18n.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/FilePane.tsx`
- Modify: frontend tests

- [ ] Add a small English/Simplified Chinese dictionary and browser-language resolver.
- [ ] Add language mode state in `App` with Auto, English, and 简体中文 choices.
- [ ] Pass translated labels into `DualPane` and `FilePane`.
- [ ] Add tests for automatic Simplified Chinese selection and manual label rendering.
- [ ] Run `npm --prefix web run test -- --run` and `npm --prefix web run build`.
