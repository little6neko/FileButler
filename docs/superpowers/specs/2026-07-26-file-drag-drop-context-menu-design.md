# File Drag, Drop, And Context Menu Design

Date: 2026-07-26

## Goal

Add desktop-style file dragging and a context menu to the dual-pane browser while preserving FileButler's existing shadcn/ui visual language and operation-preview workflow.

## Approved Behavior

### Drag Sources And Selection

- Files, directories, symlinks, and other entries can be dragged from the non-interactive area of their table row.
- A drag starts only after the pointer moves 6 CSS pixels. A normal click and a double-click therefore retain their current behavior.
- The checkbox and other interactive controls do not start a file drag.
- Dragging an already selected row carries every selected entry in visible sorted order.
- Dragging an unselected row replaces that pane's selection with the row and carries only that entry.
- Dragging activates the source pane.
- The existing marquee starts only from non-row list space, so it cannot run at the same time as row dragging.
- Pressing Escape, releasing outside a valid target, or leaving the application cancels the drag without creating a preview.

### Drop Targets

- Dropping on a directory row targets that directory.
- Dropping on a regular file, symlink, or other non-directory row targets the destination pane's current directory.
- Dropping on list whitespace or an empty-directory state also targets the destination pane's current directory.
- Directory rows take collision priority over the containing pane target.
- A directory target receives a restrained full-row accent highlight. A current-directory target highlights the list surface without implying that a regular file accepts children.
- The drag overlay uses the existing compact row styling and shows the first source name, the inferred operation, and the total count when more than one entry is being dragged.
- A drop that would leave every source in its existing parent is a no-op and does not open a preview.
- A directory cannot be moved or copied into itself or any of its descendants. If any item in a multi-item drag makes the target invalid, the whole drop is rejected.

### Operation Selection And Confirmation

- Every valid drag, including a same-pane drag, opens `OperationPreview`; no file operation starts immediately on drop.
- Same-pane drops default to `move`.
- Cross-pane drops with matching source and destination `rootId` values default to `move`.
- Cross-pane drops with different `rootId` values default to `copy`.
- Drag-initiated previews expose a compact shadcn/ui-style segmented control for switching between Move and Copy.
- Switching the operation issues a new dry-run request, clears stale plan rows, and shows the existing loading state until that request finishes.
- The selected operation determines the dialog title, description, confirmation label, dry-run request, and created job.
- Operation previews opened by the toolbar or context menu retain their existing fixed operation type.
- Canceling a preview does not change files and preserves the selection established at drag start. Successfully creating a job uses the existing jobs sheet, completion polling, selection clearing, and two-pane refresh behavior.

### Context Menu

- Right-clicking an already selected entry preserves the full selection, and menu actions apply to all selected entries.
- Right-clicking an unselected entry replaces the selection with that entry.
- Right-clicking list whitespace clears that pane's selection.
- Right-clicking activates the pane before menu state is calculated.
- The context menu always renders every action from `ActionToolbar`: Copy to the other pane, Move to the other pane, Symlink, Hardlink, New Folder, Rename, PowerRename, and Delete.
- With no selection, every action remains visible; only New Folder is enabled and all selection-dependent actions are gray and non-interactive.
- Rename is enabled for exactly one selected entry. Copy, Move, Symlink, Hardlink, PowerRename, and Delete are enabled for one or more selected entries. New Folder is always enabled.
- The menu mirrors `ActionToolbar`, not the pane header controls, so root selection, path navigation, and Refresh are not menu items.
- The menu opens at the pointer through Base UI `ContextMenu`, closes on selection, outside interaction, or Escape, and retains Base UI keyboard navigation.

## Technical Approach

Use `@dnd-kit/core` for pointer activation, cross-pane collision detection, cancellation, and the drag overlay. This adds one focused runtime dependency and avoids maintaining custom global pointer, scrolling, and collision state. Base UI's existing `ContextMenu` primitives provide pointer positioning and dismissal behavior for the context menu.

All visible controls continue to use the project's local shadcn/ui-style components, tokens, spacing, icons, and menu styles. `dnd-kit` has no independent visible theme.

## Component Design

### DualPane

`DualPane` owns the top-level `DndContext` because a drag can begin in either `FilePane` and end in either pane. It coordinates:

- the active drag payload;
- the source pane, root, entries, and ordered source paths;
- the current drop target;
- target validation;
- the default Move or Copy operation;
- creation of the drag-initiated preview request.

The drag payload contains stable data captured at drag start rather than reading whichever pane is active at drop time. Root or path changes and component unmounts cancel the active session.

Droppable IDs include the pane key and target kind so identical relative paths in the left and right panes cannot collide. Collision resolution prefers the entry directly under the pointer and falls back to the pane's current-directory target.

### FilePane

`FilePane` exposes row drag sources and two target forms:

- a directory-row target carrying that entry's `relativePath`;
- a pane-list target carrying `currentPath`.

Non-directory rows remain detectable under the pointer but resolve to the pane-list target. `FilePane` emits selection and context-menu intent through callbacks; it does not construct operation requests or compare roots.

The marquee exclusion check expands to treat entry rows as blocked starting points. This separates blank-space marquee selection from row dragging while preserving checkbox selection, sorting, resizing, and double-click navigation.

### Shared File Actions

Toolbar and context-menu renderers consume one ordered file-action descriptor list. Each descriptor owns its stable ID, Lucide icon, localized label, enabled predicate, visual grouping, and command callback. The renderers remain responsible only for presentation differences such as button variant versus menu item.

This shared model prevents the two surfaces from drifting while preserving the current command handlers in `DualPane`.

### Pane Context Menu

A small local wrapper around Base UI `ContextMenu` reuses the popup, item, separator, destructive, focus, and disabled styles already used by project menu components. It wraps only the file-list interaction surface, not the pane header or status bar.

Before opening, `FilePane` resolves the pointer target to an entry or whitespace and applies the approved selection rule. The menu then receives the resulting active-pane action descriptors.

### OperationPreview

`OperationPreview` receives optional drag-operation choices. When choices are absent, it behaves exactly as it does today. When Move and Copy choices are present, it owns the selected type for that mounted preview and derives the active `OpsRequest` from the initial request.

Every type change resets plan items, conflict state, errors tied to the previous dry-run, and loading state before requesting a new plan. Request identity guards continue to prevent an older response from enabling confirmation after a newer request has started.

## Data Flow

1. A pointer gesture on a row passes the activation distance and starts a drag.
2. `DualPane` activates the source pane and derives ordered sources from the source pane's current selection rules.
3. `dnd-kit` reports targets under the pointer. A directory row wins over the containing list; all other list locations resolve to the current directory.
4. The target validator rejects no-op, self, and descendant destinations. Invalid targets show a no-drop state and never create an `OpsRequest`.
5. On a valid drop, `DualPane` compares source and destination `rootId` values, selects the default operation, and opens `OperationPreview` with Move and Copy as allowed choices.
6. `OperationPreview` performs the existing dry run. Changing the segmented control repeats the dry run with only `request.type` changed.
7. Confirmation creates the existing background job. Success opens Jobs, clears selections, and refreshes both panes after the job reaches a terminal state.

Context-menu commands bypass drag state. They first establish the pane and selection, then call the same command handlers used by `ActionToolbar`.

## Safety And Error Handling

The frontend uses segment-aware relative-path checks rather than raw string prefixes. It rejects a directory target equal to a dragged directory or beginning with that directory plus `/`, and rejects a target current directory equal to the sources' existing parent.

The operation planner also rejects Move or Copy when the resolved destination for a source directory is the source itself or lies below it. The backend check compares cleaned resolved filesystem paths, including overlapping roots, and returns the conflict code `destination_inside_source`. This prevents recursive copies even if a request bypasses the drag UI.

Dry-run remains authoritative for target existence, missing sources, permissions, invalid roots, and other filesystem failures. Conflicts are shown in the existing preview table and keep confirmation disabled. A failed job-creation request remains in the open preview so the user can retry.

Starting a newer dry-run invalidates the older response. Drag state and visual highlights are reset on drop, cancellation, preview opening, and unmount so a failure cannot leave a stale target active.

## Visual And Accessibility Design

- Keep compact table density, square-to-small radii, neutral borders, white surfaces, and the existing accent/destructive colors.
- Use Lucide icons already present in `ActionToolbar`; do not create a second icon set for the context menu.
- The drag overlay is informational and does not affect layout dimensions.
- Valid and invalid drop states use both color and cursor/state cues rather than color alone.
- Base UI supplies menu focus movement, disabled-item semantics, dismissal, and Escape handling.
- `dnd-kit` screen-reader announcements identify drag start, current target, drop, and cancellation using localized entry and operation labels.
- Existing toolbar actions remain the keyboard-accessible alternative to pointer dragging. Keyboard-driven row reordering or dragging is not introduced.

The interaction mockup approved during design shows a compact drag overlay, full-row directory highlight, complete context menu, and a Move/Copy segmented control inside the existing operation-preview layout.

## Testing

### Frontend Unit And Component Tests

- Dragging a selected row preserves and orders the full selection; dragging an unselected row replaces it.
- Root comparison chooses Move for the same root and Copy for different roots.
- Directory rows resolve to the directory, while regular files and whitespace resolve to the current directory.
- No-op, self, and descendant destinations are rejected with segment-aware path checks.
- Marquee selection cannot start on a row, checkbox, header, resize handle, or other interactive control.
- Right-clicking selected, unselected, and whitespace targets applies the approved selection behavior.
- Toolbar and context menu render the same ordered actions, labels, icons, grouping, and enabled states.
- The empty-selection context menu shows every item while enabling only New Folder.
- Drag-enabled `OperationPreview` defaults correctly, reruns dry-run when the type changes, ignores stale responses, and submits the selected type.
- Fixed-operation previews opened through existing commands retain their current behavior.

### Backend Tests

- Planner tests reject moving and copying a directory to itself or a descendant.
- The same check works when different root IDs resolve to overlapping filesystem paths.
- Existing destination-conflict, missing-source, hardlink, delete, and mkdir plans remain unchanged.

### Browser And Regression Tests

- Playwright exercises a real same-pane directory drop and cross-pane drops onto a directory, regular file, and whitespace.
- Browser tests verify same-root Move and different-root Copy defaults, operation switching, cancel, and confirmation.
- Browser tests open row and whitespace context menus and verify selection and disabled states.
- Existing selection marquee, checkbox, sorting, resizing, double-click navigation, media preview, toolbar actions, and job refresh workflows remain green.
- Final verification runs Go tests, frontend tests, lint, type-checked production build, and focused Playwright scenarios.

## Non-Goals

- Dragging files between FileButler and the operating system or another browser tab.
- Reordering entries within the table.
- Modifier-key overrides such as holding Ctrl or Shift during a drag.
- Hover-opening directories, dropping onto breadcrumb segments, or navigating during a drag.
- Clipboard Cut, Copy, and Paste commands.
- Adding Refresh, root selection, or path navigation to the context menu.
- Redesigning the toolbar, file table, Jobs sheet, or non-drag operation previews.

## Acceptance Criteria

- Files and directories can be dragged into a directory in the same pane, with a preview required before execution.
- Cross-pane drag defaults to Move for equal root IDs and Copy for different root IDs.
- A drag can target a directory row or the destination pane's current directory through a regular-file row or whitespace.
- Every valid drag opens a dry-run preview where Move and Copy can be selected before confirmation.
- Invalid self, descendant, and no-op destinations cannot create a job, and recursive directory copies are also rejected by the backend planner.
- Right-click behavior preserves or replaces selection as approved and opens a complete toolbar-equivalent menu.
- With no selection, every menu item remains visible and gray except enabled New Folder.
- Toolbar and context menu commands share one definition and remain behaviorally consistent.
- The UI continues to look and behave like the existing shadcn/ui-based FileButler interface.
