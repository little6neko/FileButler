# File Drag Activation And Feedback Design

Date: 2026-07-26

## Goal

Make file dragging and marquee selection coexist predictably in each file pane, while ensuring drag feedback is never obscured by table dividers or the sticky header.

## Approved Behavior

### Drag Activation Area

- A file drag can start only from the compact inline area spanning the entry icon, the gap after it, and the visible file or directory name.
- The activation area begins at the icon's left edge and ends at the visible name's right edge. It does not fill the rest of the name cell.
- A symlink-target annotation shown after the entry name is outside the activation area.
- The checkbox, type, size, modified-time cells, and unused row space do not start a file drag.
- The table row remains the measured draggable node, so the existing drag overlay, source geometry, selection payload, and directory drop target continue to represent the full entry.
- Existing checkbox selection, context menus, and directory double-click navigation remain unchanged.

### Marquee Selection

- A primary-button drag starting in the type, size, or modified-time cell, in unused name-cell space after the activation area, or in other non-interactive row space starts marquee selection.
- The marquee continues to select every row whose rectangle intersects the marquee rectangle.
- The marquee does not start from the icon-and-name drag activation area, a checkbox, the table header, a resize separator, or another interactive control.
- A file drag and a marquee selection cannot become active from the same pointer gesture.

### Cursor Behavior

- Hovering a file or directory row, including its drag activation area, uses the normal arrow cursor.
- The interface changes to a grabbing cursor only after dnd-kit has activated a file drag.
- An invalid destination continues to use the not-allowed cursor while the drag is active.
- Ending or cancelling a drag immediately restores the normal cursor.

### Drop Feedback

- Valid feedback continues to use the existing primary blue color, and invalid feedback continues to use the existing destructive red color.
- Pane-level feedback is rendered by a dedicated, absolutely positioned foreground layer inside the file-list surface.
- The pane feedback layer is drawn above table cells, row dividers, and the sticky table header, so all four sides of the large feedback frame remain continuous.
- Directory-row feedback is likewise drawn in the foreground above cell dividers.
- Feedback layers use `pointer-events: none`, do not participate in layout, and cannot block dragging, marquee selection, clicking, scrolling, or context menus.

## Technical Approach

Continue using the existing `@dnd-kit/core` integration. `FileRow` keeps its table row registered as both the draggable measurement node and, for directories, the droppable node. The dnd-kit activator reference, attributes, and listeners move from the row to a tightly sized inline icon-and-name wrapper marked with a dedicated data attribute.

`FilePane` changes its marquee-origin filter from blocking every entry row to blocking only actual controls and the dedicated drag activator. The existing document-level marquee move and release handling remains unchanged.

The current `dropFeedback` object remains the only feedback state. `FilePane` derives pane-level feedback from its pane target and renders the foreground frame. `FileRow` derives directory feedback from its existing directory target. No new store, drag event protocol, or operation state is introduced.

## Component Design

### FileRow

- Keep `setNodeRef` on the `tr` so drag geometry and directory collision detection retain full-row bounds.
- Add an inline-flex drag activator around only `FileIcon` and the visible entry-name element.
- Attach dnd-kit listeners and accessibility attributes to that activator rather than the `tr`.
- Keep the symlink-target annotation adjacent to, but outside, the activator.
- Expose stable data attributes for the activator, active source state, and row feedback state so component and browser tests do not depend on styling class names.

### FilePane

- Update the marquee exclusion predicate to reject the drag activator and existing controls, but allow non-activator entry-row content.
- Render a non-interactive pane feedback element after the table and marquee element so its painting order is explicit.
- Preserve the current pane droppable registration and target matching.

### Drag Context And Styles

- Reuse the top-level active-drag state to expose an active marker on the drag surface.
- Remove idle `grab` and directory-row `pointer` cursor rules.
- Apply `grabbing` only while the active marker is present, with `not-allowed` taking precedence for invalid targets.
- Give feedback layers a stacking level higher than the sticky header's current level and keep them independent of table-row box-shadow painting.

## Data Flow

1. A primary-button gesture begins on an element inside the file list.
2. If the origin is inside the icon-and-name activator, dnd-kit owns the gesture and applies the existing movement threshold before activating a file drag.
3. Otherwise, if the origin is not an excluded control, `FilePane` owns the gesture and runs the existing marquee-selection flow.
4. During a file drag, the existing drag context calculates the target and supplies `dropFeedback`.
5. `FilePane` or `FileRow` renders the matching foreground feedback layer without changing target validation or operation selection.
6. Drop, cancellation, or unmount clears the existing active state, feedback, and active cursor.

## Error Handling And Compatibility

No API or filesystem behavior changes. Existing no-op, self-descendant, root comparison, move/copy default, dry-run, and operation-preview rules remain authoritative.

If a pointer gesture starts outside the activator, it cannot accidentally create an operation preview because dnd-kit never activates that entry. If feedback has no matching pane or directory target, no foreground layer is rendered. The existing invalid-target state still prevents a preview and supplies the red frame and not-allowed cursor.

The drag activator remains constrained by the name cell. Long names use the existing truncation behavior, so the activation area ends at the visible truncated name rather than extending beneath later columns.

## Testing

### Component Tests

- Verify the draggable row contains one dedicated activator enclosing the icon and visible name but not the symlink-target annotation.
- Verify a gesture from the activator does not start a marquee.
- Verify gestures from type, size, modified time, and unused row space can start a marquee and select intersecting rows.
- Verify checkbox interaction remains independent of dragging and marquee selection.
- Preserve coverage that files are drag sources and directories are nested drop targets.

### Style Tests

- Verify idle rows and activators no longer declare `grab` or directory `pointer` cursors.
- Verify the active drag state declares `grabbing`, with invalid targets declaring `not-allowed`.
- Verify pane and row feedback layers are non-interactive and have a stacking level higher than the sticky header.

### Browser Tests

- Update the Playwright drag helper to begin from the dedicated icon-and-name activator instead of the row center.
- Re-run same-pane and cross-pane drag scenarios to preserve target and Move/Copy behavior.
- Exercise marquee selection from a non-name table cell and verify no operation preview opens.
- Check computed cursors before and during an active drag.
- Capture desktop screenshots of valid and invalid feedback and verify the foreground frame is not covered by row dividers or the sticky header.

### Verification

Run the focused component and browser tests first, then the complete frontend test suite, ESLint, the type-checked production build, and the complete Playwright suite. Rebuild the frontend and restart the existing server bound to `0.0.0.0:8082` for manual inspection.

## Non-Goals

- Changing same-pane or cross-pane Move/Copy defaults.
- Changing drop-target validation, operation previews, or job execution.
- Changing click selection, checkbox behavior, context-menu selection, or double-click navigation.
- Adding a permanently visible drag handle or changing file-table columns and density.
- Adding touch-specific drag gestures, keyboard dragging, operating-system drag integration, or automatic directory opening.

## Acceptance Criteria

- Only the area from the entry icon through the visible file or directory name can initiate a file drag.
- Dragging from all other non-interactive row areas starts marquee selection.
- Rows retain the normal arrow cursor until a file drag is active.
- Valid and invalid pane feedback frames remain continuous above row dividers and the sticky header.
- Directory-row feedback is not obscured by cell dividers.
- Existing same-pane and cross-pane drag workflows, operation defaults, previews, checkbox selection, and directory navigation remain functional.
