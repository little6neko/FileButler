# PowerRename Application Window Implementation Plan

**Goal:** Turn PowerRename into a multi-instance desktop application window in full mode while preserving the existing modal in compact mode.

**Architecture:** Generalize the geometry-only window manager to a discriminated `file | powerRename` record union. Keep PowerRename snapshots, controlled options, and submission state in an instance registry keyed from the application window. Extract the current dialog body into reusable content, then wrap it with either `Dialog` in compact mode or `WindowFrame` in desktop mode. Existing rename preview/create APIs and job SSE remain unchanged.

**Tech Stack:** React 19, TypeScript 6, Vitest, Testing Library, shadcn/Base UI, Tailwind CSS, and the existing FileButler task event store.

---

### Task 1: Generalize the desktop window model

**Files:**
- Modify: `web/src/windowManager.ts`
- Modify: `web/src/windowManager.test.ts`
- Modify: `web/src/components/WindowFrame.tsx`

- [ ] Add a failing window-manager test that opens one file window and one PowerRename window and verifies kind-specific references, focus order, MRU fallback, and preservation through geometry transitions.
- [ ] Replace the file-only record with a shared base plus `file` and `powerRename` discriminated records.
- [ ] Add `openPowerRenameWindow` while retaining `openFileWindow` as a typed convenience entry point.
- [ ] Make all pure geometry and ordering helpers operate on the union without inspecting business payloads.
- [ ] Add an application-specific minimum-size resolver and pass it through opening, movement, resizing, and viewport reconciliation; keep existing file-window dimensions unchanged.
- [ ] Change `WindowFrame` to accept the shared record, a caller-supplied title icon, and a disabled-close state.
- [ ] Run `npm test -- --run src/windowManager.test.ts` from `web/`.
- [ ] Commit as `refactor: generalize desktop window records`.

### Task 2: Extract reusable, multi-instance PowerRename content

**Files:**
- Modify: `web/src/components/RenameDialog.tsx`
- Modify: `web/src/components/RenameDialog.test.tsx`

- [ ] Add failing tests that render two PowerRename bodies concurrently and assert independent options, independent preview responses, unique form/control IDs, and disabled cancel/submit behavior while an external submission is pending.
- [ ] Export a cloneable default `RenameOptions` value for new desktop instances.
- [ ] Extract `PowerRenameContent` from the modal shell. Make options, submission status, submission error, close, and submit callbacks controlled props; keep preview request/list/conflict state local to each mounted body.
- [ ] Scope every input, label, checkbox, combobox, preset-list, and option ID with `useId` so simultaneous windows have no duplicate DOM IDs.
- [ ] Preserve latest-preview-only semantics so an older response cannot replace the newest option preview.
- [ ] Keep `RenameDialog` as the compact-mode wrapper with its current public API and local submit orchestration, delegating its UI to `PowerRenameContent`.
- [ ] Preserve Enter confirmation, preset keyboard handling, conflict disabling, option commits, and current API payloads.
- [ ] Run `npm test -- --run src/components/RenameDialog.test.tsx`.
- [ ] Commit as `refactor: extract reusable PowerRename content`.

### Task 3: Add desktop PowerRename instances and launch paths

**Files:**
- Modify: `web/src/components/FileWorkspace.tsx`
- Modify: `web/src/components/FileWorkspace.test.tsx`
- Modify: `web/src/components/WorkspaceShell.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/i18n.test.ts`
- Modify: `web/src/styles.css`

- [ ] Add failing workspace tests for opening PowerRename from a full-mode toolbar and context menu, creating multiple independent windows, immediate focus, one taskbar item per instance, and fixed ordered-path snapshots.
- [ ] Add a `PowerRenameInstance` registry/ref containing `rootId`, ordered `paths`, source title, controlled options, `submitting`, and `submitError`.
- [ ] In desktop mode, make every PowerRename command capture the current real-directory selection and atomically add a new instance plus a focused PowerRename window. In compact mode, retain the existing modal command.
- [ ] Render desktop windows by `kind`; file records continue to use `FilePane`, while PowerRename records render the shared content inside `WindowFrame`.
- [ ] Extend taskbar metadata with window kind, render `Files` for file windows and `ScanText` for PowerRename, and add localized `PowerRename — N items/项` titles.
- [ ] Add the PowerRename window layout needed for a resizable two-column body without changing file-window styling.
- [ ] Make close/cancel clean only the target application instance, and retain source browser sessions independently.
- [ ] Run focused `FileWorkspace`, `WorkspaceShell`, and i18n tests.
- [ ] Commit as `feat: add PowerRename desktop windows`.

### Task 4: Preserve mode, keyboard, and submission correctness

**Files:**
- Modify: `web/src/components/FileWorkspace.tsx`
- Modify: `web/src/components/FileWorkspace.test.tsx`
- Modify: `web/src/components/WindowFrame.tsx`
- Modify: `web/src/components/WindowFrame.test.tsx` if a dedicated control test is clearer than workspace coverage

- [ ] Add failing tests proving source navigation/selection/closure cannot change an open PowerRename snapshot.
- [ ] Add mode-round-trip tests proving compact mode keeps its modal, hides application taskbar items, excludes application records from compact-pane bindings, and restores PowerRename draft/geometry/status when returning to desktop.
- [ ] Filter every browser-session derivation by `kind === "file"`: visible sessions, active session, activation lookup, task refresh, session retention, and desktop/compact mode conversion.
- [ ] Ensure an active PowerRename produces no active browser session so global copy/cut/paste cannot act on the previously focused file window.
- [ ] Move desktop task creation to an instance-level controller. Persist the submission lock and error across unmount; disable close/cancel during task creation while still allowing minimize and mode switching.
- [ ] On success, commit defaults, remove only the submitting instance, and register the returned task ID. On failure, retain the window and make it retryable.
- [ ] Add a regression test that submits, minimizes or switches mode before the response, then proves a second task cannot be created and the eventual response is still handled exactly once.
- [ ] Run focused window/workspace/PowerRename tests.
- [ ] Commit as `fix: isolate PowerRename window lifecycle`.

### Task 5: Full verification and handoff

**Files:**
- Verify: `web/src/windowManager.ts`
- Verify: `web/src/components/WindowFrame.tsx`
- Verify: `web/src/components/WorkspaceShell.tsx`
- Verify: `web/src/components/RenameDialog.tsx`
- Verify: `web/src/components/FileWorkspace.tsx`
- Verify: `web/src/styles.css`

- [ ] Run `npm test -- --run` from `web/`.
- [ ] Run `npm run lint` from `web/`.
- [ ] Run `npm run build` from `web/`.
- [ ] Run `go test ./...` from the repository root to confirm frontend-only changes did not disturb embedded assets or integration contracts.
- [ ] Run `git diff --check` and inspect all commits for unrelated changes.
- [ ] Exercise the running test service manually: open several file windows, launch multiple PowerRename windows from toolbar/context menu, move/resize/minimize/maximize them, switch modes, and submit a real rename task.
- [ ] Confirm the service still listens on `0.0.0.0` and report the test URL and final commit list.
