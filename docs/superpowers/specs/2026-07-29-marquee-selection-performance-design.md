# Marquee Selection Performance Design

Date: 2026-07-29

## Goal

Make marquee selection remain responsive as a pane contains hundreds or thousands of entries, without changing its visible UI or any existing selection, scrolling, or file-drag behavior.

## Approved Behavior

- The marquee remains available from the same row regions and list whitespace.
- Movement below 4 CSS pixels remains a click; movement at or beyond the threshold becomes marquee selection.
- Checked rows, row highlighting, selection counts, and selected-byte totals continue updating while the pointer moves.
- Positive-area overlap selects a row, while edge-only contact does not.
- Holding the pointer near the upper or lower edge continues auto-scrolling at the existing speed and can select entries outside the initial viewport.
- Single-click, Ctrl-click, Shift-click, checkboxes, sorting, column resizing, double-click navigation, context menus, and operation previews retain their current behavior.
- The icon-and-visible-name region remains the only file-drag activator. Selected-group dragging and dragging an unselected entry retain their current semantics.
- No styling, row density, cursor, animation, table structure, or backend API changes are introduced.

## Current Bottlenecks

The current gesture controller performs an unthrottled selection update for every mousemove event. Each update queries every table row and reads every row rectangle, so layout work grows linearly with the number of rendered entries and can occur more often than the display refresh rate.

Every changed marquee result creates a new pane selection set in DualPane. That rerenders FilePane and all FileRow components, including each row's draggable and droppable hooks. FilePane also converts the complete selected set to an array separately for every rendered row. With N rows and S selected entries, that allocation costs O(N × S) per selection render and approaches quadratic behavior as the marquee expands.

## Architecture

### Frame-Coalesced Gesture Controller

FilePane keeps the latest pointer coordinates in the active gesture state. Mousemove only records those coordinates, checks the existing activation threshold, and requests one animation frame if none is pending. It does not perform geometry reads, selection updates, or React state updates directly.

One frame callback owns both pointer-driven selection and edge auto-scroll:

1. Calculate the existing edge velocity from the latest pointer position.
2. Apply one clamped vertical scroll step when scrolling is possible.
3. Convert the latest pointer into list-content coordinates.
4. Update the marquee rectangle once.
5. Derive and emit the intersecting ordered paths once.
6. Schedule the next frame only when edge auto-scroll must continue or newer pointer input arrived during the frame.

This guarantees at most one marquee calculation per display frame and prevents independent mousemove and auto-scroll paths from duplicating work.

### Cached Row Geometry

When a gesture crosses the marquee threshold, FilePane measures the list and all visible table rows once. Each row becomes a plain cached record containing its path and top and bottom edges in list-content coordinates. The cache preserves current visible order and the current rule that row hit regions span the list viewport horizontally.

Vertical auto-scroll changes scrollTop but not a row's content-space position, so the same cache remains valid throughout the gesture. Hit testing uses the cached records and a pure positive-area rectangle intersection helper; it never queries rows or reads row layout during later frames.

The cache is discarded on mouse release, window blur, path or root change, and component unmount. If the row collection or list dimensions become unusable during a gesture, the controller safely stops emitting new geometry rather than throwing. Navigation already cancels the gesture, so stale geometry cannot cross directories.

### Imperative Marquee Rectangle

The marquee rectangle is mounted when the gesture activates and unmounted during cleanup. While active, its left, top, width, and height styles are updated through a DOM ref inside the frame callback. Pointer movement therefore does not rerender FilePane merely to reposition the translucent rectangle.

The rectangle keeps the existing class and CSS, so its appearance and stacking remain unchanged.

### Row Render Isolation

FileRow becomes memoized around behavior-relevant props. A selection update still rerenders FilePane so the status bar and select-all state remain live, but React skips FileRow rendering when that row's selected state and other meaningful inputs have not changed.

Callbacks passed to rows are made stable or deliberately excluded only where their behavior is independent of render-local values. Root, parent path, entry, language labels, drop feedback, and selected state remain comparison inputs so navigation, localization, and drag feedback cannot become stale.

The optimization does not mutate row selection outside React. Checkboxes, aria-selected, row highlighting, and pane totals therefore remain synchronized with the authoritative DualPane selection set.

### Lean File-Drag Metadata

FileDragData carries only the dragged entry identity and its pane, root, and parent-directory context. It no longer embeds selectedPaths and visibleEntries in every row.

At drag start, DualPane resolves the source entries from the latest authoritative PaneState for the source pane:

- if the activated entry is selected, the drag source contains all selected entries in current visible order;
- if it is not selected, the drag source contains only that entry and selection changes to that entry as it does today.

This removes repeated selected-array allocation and keeps the payload stable across marquee updates without changing drag results.

## Data Flow

1. A permitted primary-button press creates a pending click-or-marquee gesture.
2. Crossing the 4-pixel threshold snapshots row geometry and mounts the marquee rectangle.
3. Mousemove stores the latest pointer and schedules a shared frame.
4. The frame optionally scrolls, updates the rectangle, hit-tests cached rows, and emits paths only when the ordered result differs from the last result.
5. DualPane replaces the authoritative selection set and clears the range anchor as it does today.
6. FilePane updates pane totals, while memoized rows rerender only when their own relevant state changes.
7. Mouse release preserves the latest selection and cleans up the frame, listeners, cache, and rectangle.
8. A later file drag resolves its selected group from the latest pane state rather than row-copied arrays.

## Cleanup And Failure Safety

- Only one animation frame may be pending for a marquee gesture.
- Cleanup is idempotent and removes document listeners, the blur listener, the pending frame, cached geometry, and the rectangle.
- Auto-scroll remains clamped between zero and the list's maximum scrollTop and stops when the requested boundary is reached.
- Duplicate ordered path lists are not emitted.
- Missing or detached DOM nodes cause a safe no-op for that frame.
- All changes remain frontend-only and cannot create filesystem operations without the existing explicit operation preview and confirmation.

## Testing

### Pure And Component Tests

- Multiple mousemove events before one animation frame produce one geometry and selection update using the latest pointer.
- Row rectangles are read once when the marquee activates and are not reread during pointer movement or auto-scroll frames.
- Cached content coordinates preserve selection while scrolling in both directions.
- Positive overlap remains selected and edge-only contact remains excluded.
- Duplicate selected path lists remain suppressed.
- The marquee rectangle is present only while active and receives the expected geometry.
- Release, blur, navigation, and unmount cancel the pending frame and discard cached geometry.
- Live checkbox, aria-selected, row highlight, count, and byte-total updates remain correct.
- Unchanged FileRow components do not rerender during unrelated selection changes.
- Dragging a selected entry still includes the selected group in visible order, while dragging an unselected entry still uses only that entry.

### Regression Verification

Run focused FilePane, FileRow, DualPane, file-selection, and file-drag tests, followed by the complete Vitest suite, ESLint, the production frontend build, backend Go tests, and relevant Playwright selection and drag/drop flows. Manually verify the long temporary directory through the running 0.0.0.0 test server.

## Non-Goals

- Virtualizing the file table.
- Changing the marquee threshold, edge band, maximum scroll speed, or selection intersection rules.
- Adding horizontal auto-scroll, modifier-aware marquee variants, keyboard navigation, or touch marquee selection.
- Redesigning the table, selection visuals, status bar, or drag-and-drop UI.
- Changing filesystem APIs or operation semantics.

## Acceptance Criteria

- The existing selection and file-drag test suites preserve their behavior.
- Marquee selection remains visibly live and responsive with the current 260-entry temporary fixture.
- Mousemove geometry work is capped at one calculation per animation frame.
- Every row rectangle is measured at most once per marquee gesture unless the gesture is cancelled and restarted.
- FilePane no longer creates one complete selected-path array per rendered row.
- Selection-only updates skip rendering rows whose meaningful props did not change.
- No visible UI, cursor, scrolling, sorting, selection, context-menu, or operation behavior changes.
