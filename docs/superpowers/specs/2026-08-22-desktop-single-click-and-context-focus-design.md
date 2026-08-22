# Desktop Single-Click and Context-Opened Window Focus Design

## Goals

1. Open a new File Manager window on every single click of the full-mode desktop icon.
2. Keep a directory window opened from the context menu active and above the source window.

## Scope

- Change the full-mode desktop File Manager icon from double-click activation to single-click activation.
- Correct context-menu event propagation so “Open in new window” leaves the new window active.
- Keep mapped-root cards on “All locations” and ordinary folder rows on double-click navigation.
- Keep compact-mode navigation, window geometry, taskbar behavior, and backend APIs unchanged.

## Current Focus Defect

`openFileWindow` already creates a window with the highest order and assigns its ID to `activeWindowId`. However, context-menu items render through a React portal beneath the source pane in the React tree. After “Open in new window” creates the new window, the item click continues bubbling to the source `FilePane` click handler, which activates and raises the old window again.

The fix belongs at the menu event boundary. Delaying another focus call would depend on event timing and would leave the unintended pane activation in place.

## Interaction Design

### Desktop icon

- A pointer single-click calls `openVirtualRootWindow` once.
- Every separate click creates a new independent virtual-root window; existing windows are not reused.
- The icon remains a native button. Enter and Space use its native click activation and each create exactly one window.
- The explicit double-click and keydown handlers are removed so one interaction cannot create duplicate windows.

### Context-opened directory window

- A context-menu item click stops propagation before invoking its command.
- Existing menu commands, menu closing, context selection, and disabled states remain unchanged.
- “Open in new window” creates the existing independent directory session and window.
- Because the click no longer reaches the old `FilePane`, the new window remains `activeWindowId`, has the highest z-order, is marked active in the UI and taskbar, and becomes the target for window-scoped keyboard commands.

## Components and Data Flow

- `FileWorkspace` maps the desktop icon’s native `onClick` directly to `openVirtualRootWindow`.
- `PaneContextMenu` owns the portal event boundary. Its item handler stops React click propagation and then runs the existing `FileAction` command.
- `openDirectoryWindow`, `openWindowForSession`, and `windowManager.openFileWindow` continue to create and activate windows without timing workarounds.

No new state or callback contract is required.

## Error Handling

This change introduces no asynchronous operation or new error state. Existing browse and operation error handling remains unchanged.

## Testing

Component and end-to-end coverage will verify that:

- one desktop-icon click creates one window;
- repeated clicks create one independent window per click;
- Enter and Space each create only one window;
- mapped-root cards and ordinary folder rows still require double-click;
- context-menu commands still execute after propagation is stopped;
- “Open in new window” leaves the new window active and above the source window;
- the active-window taskbar state and keyboard-command destination follow the new window.
