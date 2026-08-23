# Mode-Switch Transient Dialog Cleanup Design

## Goal

Close transient dialogs when switching between compact and full workspace modes so a dialog from the previous mode never remains visible or reappears later.

## Current Problem

`switchWorkspaceMode` currently closes the jobs sidebar and full-mode window-local dialogs. It does not clear the page-level state used by compact-mode dialogs, so rename and operation dialogs can remain mounted over the full desktop after a compact-to-full switch.

## Approved Scope

Every mode change will close these transient UI surfaces:

- Jobs sidebar.
- Copy, move, delete, and other operation confirmations.
- Single-item rename dialog.
- New-folder dialog.
- Compact-mode PowerRename dialog.
- Image and video preview dialog.
- Full-mode window-local child dialogs.

Standalone full-mode PowerRename application windows are managed desktop windows, not transient dialogs. Their existing persistence and minimize behavior will remain unchanged.

## Implementation

Add one mode-switch cleanup function in `FileWorkspace`. It will synchronously reset all page-level transient-dialog state and clear the window-dialog registry. `switchWorkspaceMode` will call it before changing workspace bindings or mode state in either direction.

Conditional rendering alone will not be used because retaining hidden dialog state would allow stale dialogs to reappear after a later mode switch. A mode-change effect will not be used because it would clean up one render after the new mode appears.

## In-Flight Requests

Closing a dialog does not cancel an API request that has already been submitted. Existing promise handlers continue to:

- Register a successfully created background job.
- Clear the relevant clipboard state after a successful move when required.
- Leave request-failure handling unchanged.

Completion or failure must not reopen the dismissed dialog.

## Verification

- Add regressions for compact-to-full switching with single rename and operation confirmation dialogs open.
- Cover the remaining page-level transient states where practical through the same cleanup path.
- Verify switching back to compact mode does not restore a dismissed dialog.
- Keep existing full-mode local-dialog and standalone PowerRename lifecycle tests passing.
- Run the complete frontend test suite, lint, and production build.
- Perform a real-browser compact-to-full switch with an open dialog and confirm no page-level dialog remains.

## Non-goals

- Canceling submitted file-operation jobs.
- Deleting or closing standalone PowerRename application windows.
- Changing normal dialog close buttons, validation, or submission behavior.
