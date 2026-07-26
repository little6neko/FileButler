# Manual Jobs Sheet And Enter Confirmation Design

Date: 2026-07-26

## Goal

Keep background task progress available without interrupting file workflows, and make Enter a consistent confirmation shortcut in every file-operation confirmation dialog.

## Approved Behavior

### Jobs Sheet

- Creating an operation or rename job never opens the Jobs sheet automatically.
- The existing Jobs buttons remain the only way to open the sheet.
- Job creation still closes the originating dialog, clears file selections, shows the success toast, starts completion polling, updates the active-job count, and refreshes both panes when the job reaches a terminal state.
- Closing and reopening the Jobs sheet retains its existing behavior.

### Enter Confirmation

Enter confirms these four dialog types:

- the common operation preview used by copy, move, links, delete, mkdir, and drag-initiated operations;
- PowerRename;
- single-item rename;
- the new-folder name dialog.

Media preview is excluded because it has no confirmation action.

Enter invokes exactly the same callback and request as the visible primary button. It does nothing while that button is disabled, including preview loading, conflicts, invalid empty names, or an in-flight submission. Escape behavior is unchanged.

Keyboard interaction inside a more specific control takes priority. Enter does not override focused buttons, links, radio controls, checkboxes, options, textareas, or editable content. It also does not confirm during IME composition or from a repeated keydown. A child control that calls `preventDefault`, such as a highlighted PowerRename preset, consumes Enter before the dialog confirmation handler sees it.

## Technical Approach

Add a small shared dialog-keyboard helper under `web/src/components/`. Each of the four dialogs attaches it to `DialogContent` and supplies its existing enabled predicate plus its existing confirmation callback. Keeping the listener inside each popup avoids a global window listener affecting menus, media preview, or a dialog that is not active.

The helper handles bubbled keydown events so child controls run first. It checks the event key, `defaultPrevented`, IME composition, key repeat, the focused target type, and the dialog-specific enabled flag before preventing the default event and calling confirm.

The common operation preview initially focuses its popup content instead of the first footer or operation-mode button. This leaves immediate Enter available for confirmation once dry-run loading completes while preserving normal Enter behavior after the user deliberately focuses a button or mode control. Input-oriented dialogs retain their current input focus behavior.

Remove only `setJobsOpen(true)` from `DualPane.handleJobCreated`. The AppShell Jobs command remains wired to `setJobsOpen(true)`, and the mounted `JobsSheet` continues reporting active counts while closed.

## Error And Concurrency Handling

- The keyboard path reuses the same `submitting` guard and async function as the primary button, so it cannot bypass conflict or validation state.
- A failed create-job request remains in its existing dialog and displays the existing error.
- Enter during a dry-run transition is ignored until the current preview is authoritative.
- PowerRename preset selection remains deterministic: highlighted preset selection wins over dialog confirmation.

## Testing

- Update `DualPane` integration tests to assert that job creation does not render the Jobs sheet, while toast, polling, selection clearing, and terminal refresh still occur.
- Keep explicit Jobs-button coverage to prove the sheet can still be opened manually.
- Add Enter-confirm tests for operation preview, PowerRename, single rename, and new folder.
- Verify disabled confirmation states ignore Enter.
- Verify Enter on a highlighted PowerRename preset selects the preset without creating a job.
- Run the complete frontend suite, lint, production build, and focused browser checks if component behavior cannot fully exercise Base UI focus handling.

## Non-Goals

- Changing task polling, task notifications, active-job badges, or Jobs-sheet contents.
- Adding Enter behavior to media preview, authentication, initialization, navigation, menus, or non-dialog surfaces.
- Changing Escape, Tab, Space, or arrow-key behavior.
- Adding visible shortcut instructions to the interface.

## Acceptance Criteria

- No job-creation path opens the Jobs sheet without an explicit Jobs-button click.
- Existing job feedback, polling, active count, and pane refresh behavior remain intact while the sheet is closed.
- Enter confirms all four approved dialog types only when their primary action is enabled.
- Enter never bypasses dry-run conflicts, invalid names, or submission guards.
- PowerRename preset Enter behavior and focused-control keyboard semantics remain intact.
