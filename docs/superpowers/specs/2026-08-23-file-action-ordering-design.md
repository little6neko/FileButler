# File action ordering design

## Goal

Make the compact and full workspace modes expose action menus that match their different workflows, keep toolbar ordering consistent with each mode, and remove the special blue treatment from the first toolbar button.

## Action sequences

### Compact mode

The pane context menu displays these actions in order:

1. Copy to the other pane
2. Move to the other pane
3. Create symbolic link
4. Create hard link
5. Rename
6. PowerRename
7. New folder
8. Delete

The compact context menu does not display Open in new window, clipboard Copy, Cut, or Paste. Keyboard clipboard shortcuts remain unchanged.

The compact toolbar uses the same sequence. New folder therefore moves from before Rename to immediately after PowerRename.

### Full mode

The window context menu displays these actions in order:

1. Open in new window
2. Copy
3. Cut
4. Paste
5. Rename
6. PowerRename
7. New folder
8. Delete

The full-mode toolbar displays Rename, PowerRename, New folder, and Delete in that order. Clipboard actions and Open in new window remain context-menu-only.

## Implementation structure

Action descriptors remain the source of labels, icons, enabled states, and command callbacks. Compact and full modes assemble explicit action sequences instead of sorting actions inside rendering components. The compact context menu reuses only its compact toolbar descriptors; the full context menu composes its clipboard/window-opening descriptors before its reordered file-management descriptors.

Separators may distinguish logical groups, but must not change the specified item order or create a leading separator.

## Toolbar appearance

The first toolbar action no longer receives the primary/default blue variant based on its array index. All non-destructive toolbar actions use the same neutral outline treatment. Delete retains its existing destructive red treatment.

## Behavior preserved

This change does not alter action callbacks, selection rules, disabled states, keyboard shortcuts, clipboard state, confirmation dialogs, or the availability of Delete. It changes only visibility, ordering, separators, and the first-button visual variant described above.

## Verification

Tests cover:

- compact toolbar and context-menu ordering;
- absence of Open in new window, clipboard Copy, Cut, and Paste from the compact context menu;
- full toolbar and context-menu ordering, including Delete last;
- the neutral variant of the first toolbar button and the destructive styling of Delete;
- existing enablement and command-dispatch behavior.

Run the focused component tests, the complete frontend unit suite, lint, production build, and relevant browser end-to-end tests. Verify the rebuilt application on the existing `0.0.0.0:8082` test service.
