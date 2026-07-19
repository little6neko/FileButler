# Context-Aware Preview Columns Design

Date: 2026-07-19

## Goal

Remove redundant path columns from operation previews while preserving the information needed to understand and confirm each operation.

## Approved Behavior

Preview tables display columns according to the operation:

| Preview | Columns |
| --- | --- |
| PowerRename | Old name, New name, Status |
| Create directory | Destination, Status |
| Delete | Source, Status |
| Copy, move, symlink, hardlink | Source, Destination, Status |

The localized `Source` and `Destination` strings remain available because other operation types still use them.

## Component Design

### PowerRename

`RenameDialog` removes the `Source` header and the `sourcePath` cell from each live-preview row. `sourcePath` remains part of each plan item and continues to provide the React row key and backend identity. Existing old-name, new-name, changed-row highlighting, conflict status, and submission behavior remain unchanged.

### Operation Preview

`OperationPreview` derives two display flags from `request.type`:

- Show the source column unless the operation is `mkdir`.
- Show the destination column unless the operation is `delete`.

The table conditionally renders both the header and matching body cell for each flag. This keeps header and row cell counts aligned and preserves semantic table navigation for assistive technology.

The source and destination formatting helpers remain unchanged. Request payloads, dry-run responses, conflict detection, warning messages, and job creation are outside the scope of this change.

## Testing

Component tests will verify:

- PowerRename renders Old, New, and Status headers without Source, and does not render a distinct source path value.
- Create-directory preview renders Destination and Status without Source.
- Delete preview renders Source and Status without Destination.
- Copy preview continues to render Source, Destination, and Status.
- Existing conflict, localization, path formatting, and submission tests remain green.

## Non-Goals

- Changing backend plan item types or API responses.
- Removing global localization fields for Source or Destination.
- Redesigning preview dialogs, changing their width, or altering table styling.
- Changing Jobs or other history views.

## Acceptance Criteria

- No Source column appears in PowerRename live preview.
- No Source column appears in create-directory operation preview.
- No Destination column appears in delete operation preview.
- All remaining headers align with their row cells.
- Copy, move, and link previews retain both path columns.
- Operation execution behavior is unchanged.
