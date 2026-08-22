# Jobs Sheet Taskbar Layout and Toggle Design

## Goals

1. Position the Jobs sheet below the 44-pixel system taskbar so its header and close control are never covered.
2. Make the taskbar Jobs button toggle the sheet open and closed.
3. Close an open Jobs sheet when the user selects a taskbar window or switches workspace mode.

## Scope

- Change only the taskbar-aware Jobs sheet and the explicit taskbar interactions that control workspace context.
- Keep generic sheets, dialogs, previews, task execution, job events, and backend APIs unchanged.
- Keep the existing sheet close button, backdrop dismissal, and Escape dismissal.

## Layout Design

The measured taskbar occupies viewport coordinates `y=0..44`, while the current fixed Jobs sheet begins at `y=0`. Its title therefore renders behind the taskbar.

- Define `--system-taskbar-height: 44px` as a shared root-level CSS variable.
- Use the variable for the first row of `.workspace-shell` instead of a second hard-coded `44px` value.
- Add a Jobs-specific class to `JobsSheet` rather than changing the shared `SheetContent` primitive.
- The Jobs sheet starts at `top: var(--system-taskbar-height)` and uses `height: calc(100dvh - var(--system-taskbar-height))`.
- The system taskbar remains visible and interactive. The existing backdrop and sheet animation remain unchanged.

## Interaction Design

### Jobs button

`WorkspaceShell` receives the current `jobsOpen` state and an `onJobsToggle` callback.

- Clicking while closed opens the sheet.
- Clicking while open closes the sheet.
- The button exposes `aria-expanded={jobsOpen}`.
- Job-count updates do not change whether the sheet is open.

### Taskbar window selection

Selecting any desktop taskbar window first closes the Jobs sheet, then preserves the existing window action: focus an inactive window, restore a minimized window, or minimize the already active window.

The close is attached to this explicit taskbar callback. Ordinary background window-state updates do not dismiss the sheet.

### Workspace mode switching

When the requested mode differs from the current mode, the mode-switch handler first closes the Jobs sheet and then performs the existing compact/full transition. Clicking or receiving the current mode as a no-op does not introduce another behavior.

### Unchanged dismissal behavior

`JobsSheet.onOpenChange` remains connected to the same state setter, so its close button, backdrop click, and Escape key continue to close it. Clicking within a desktop window, changing language, or receiving job events does not automatically close it.

## Components and Data Flow

- `styles.css` owns the shared taskbar-height variable and the Jobs-specific fixed bounds.
- `JobsSheet` adds the dedicated class to `SheetContent`.
- `WorkspaceShell` renders the toggle state through `aria-expanded` and calls `onJobsToggle`.
- `FileWorkspace` remains the owner of `jobsOpen`; it toggles the state from the Jobs button and closes it in the taskbar-window and mode-switch entry points.

No new global store, effect-based watcher, or backend state is required.

## Error Handling

This change adds no asynchronous operation or error state. Job loading, reconnecting, cancellation, and operation errors remain unchanged.

## Testing

Component and browser coverage will verify that:

- the Jobs sheet has the dedicated positioning class;
- the shared taskbar height controls both workspace rows and sheet bounds;
- the Jobs button opens the sheet and a second click closes it;
- `aria-expanded` follows the sheet state;
- selecting a taskbar window closes the sheet and still performs the window action;
- switching full/compact mode closes the sheet and still changes mode;
- Escape and the sheet close control continue to work;
- in a real browser, the sheet top is at or below the taskbar bottom and the sheet bottom remains within the viewport.
