# Single Root Path And Modal I18n Design

Date: 2026-06-20

## Goal

Refine the FileButler browser so the normal deployment uses one mapped root shown as `/`, path navigation behaves like a Windows file manager, operations always target the opposite pane, active pane state is visually obvious, and operation dialogs are localized.

## Requirements

- The UI treats a single configured root as `/` and does not present it as Downloads/Media.
- The current path renders as clickable path segments after navigation, for example `/ > folder > sub`.
- The path input remains editable with directory suggestions and Enter navigation.
- Copy, move, symlink, and hardlink use the opposite pane's current path as destination.
- Delete has no destination.
- The active pane has a visible frame and label state so the user can tell whether left or right is active.
- Operation preview, rename dialog, and jobs panel use the same English/Simplified Chinese labels as the main UI.
- The local test server config maps one root directory.

## Design

`DualPane` remains the source of truth for active pane, pane path, and selection. `FilePane` renders both an editable path input and a clickable path segment row derived from `currentPath`. With one root, root selection is hidden and replaced by a compact `/` root marker.

Operation creation continues to use `activePane` as source and computes the opposite pane as destination. Tests assert the dry-run request payload so regressions are caught. Dialog components receive `UIStrings` props and use dictionary labels instead of hard-coded English strings.
