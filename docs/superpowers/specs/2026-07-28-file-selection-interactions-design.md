# File Selection Interactions Design

Date: 2026-07-28

## Goal

Add desktop-style row selection, Ctrl multi-selection, Shift range selection, and edge-driven marquee auto-scrolling while preserving the existing boundary between file dragging and marquee selection.

## Approved Behavior

### Click Selection

- A primary-button click anywhere on a file or directory row selects only that entry.
- Outside the icon-and-name activator, a click is recognized when the pointer is released without moving beyond the existing 4 CSS-pixel marquee threshold.
- Clicking the icon-and-visible-name drag activator still selects the row when dnd-kit does not activate a file drag.
- Clicking a checkbox retains its existing independent toggle behavior instead of collapsing the selection to one entry.
- Clicking list whitespace, double-clicking an entry, and opening a context menu retain their current behavior.
- Each selected row exposes `aria-selected` so the rendered accessibility state matches the visible selection.

### Ctrl Multi-Selection

- Ctrl-clicking an unselected row adds it without clearing other selected rows.
- Ctrl-clicking a selected row removes it without changing the other selected rows.
- The Ctrl-clicked entry becomes the pane's most recent selection anchor.
- Releasing Ctrl does not alter the current selection. The next unmodified row click returns to single-selection behavior.

### Shift Range Selection

- Shift-click uses the pane's most recent selection anchor and the current visible sorted order.
- With a valid anchor, Shift-click replaces the selection with every entry from the anchor through the clicked entry, inclusive.
- With no valid anchor, the first Shift-click behaves as an ordinary single click and establishes that entry as the anchor.
- Keeping Shift held and clicking another entry selects the inclusive range between the established anchor and the new endpoint.
- Releasing Shift does not immediately alter the selection. A later unmodified click selects only its row and establishes a new anchor.
- If Ctrl and Shift are both held, Shift range selection takes precedence. Additive Ctrl+Shift range selection is not introduced.

### Marquee Selection And Auto-Scroll

- A primary-button gesture starting outside interactive controls and outside the icon-and-name drag activator begins as a pending click or marquee gesture.
- Moving beyond 4 CSS pixels converts the gesture to marquee selection and prevents the pending row click.
- The existing allowed marquee origins remain allowed: unused name-cell space, type, size, modified-time, and list whitespace.
- While the pointer is inside an edge band at the top or bottom of the list, or beyond that edge, the current pane scrolls vertically in that direction.
- Auto-scroll speed increases with edge proximity or overshoot and is capped so rows remain controllable.
- Marquee geometry uses list-content coordinates, so the selection can include entries that scroll out of the viewport after the gesture starts.
- Selection updates while the pointer moves or auto-scroll advances. Duplicate path sets are not emitted repeatedly.
- Completing a marquee keeps its selected paths and clears the Shift anchor because a marquee has no single unambiguous anchor.
- Marquee selection continues to replace the pane's current selection; Ctrl-marquee and Shift-marquee variants are not introduced.

### File Drag Compatibility

- A drag beginning on the compact icon-and-visible-name activator remains owned by dnd-kit and performs the existing file drag workflow.
- The activator retains dnd-kit's existing 6 CSS-pixel file-drag activation distance; it does not adopt the marquee controller's 4-pixel threshold.
- A short click on that activator selects the row without opening an operation preview.
- A gesture beginning elsewhere in the row can become a marquee and can never become a file drag.
- Existing drag source grouping, same-root Move defaults, different-root Copy defaults, target validation, feedback, and operation previews remain unchanged.

## Technical Approach

Use one explicit pointer-gesture controller in `FilePane` for pending row clicks, marquee activation, marquee geometry, and vertical auto-scroll. Keep dnd-kit's existing activator ownership for the icon-and-name region. No additional runtime dependency is needed.

Keep authoritative selection state in `DualPane`. Each pane gains a nullable anchor path alongside its selected-path set and visible sorted order. Selection changes are expressed as intents rather than reimplementing Ctrl and Shift rules in each row.

Extract the deterministic selection transitions into a small pure helper so single, toggle, and range behavior can be tested without DOM geometry. `FilePane` remains responsible for translating mouse modifiers and pointer gestures into those intents.

## Component Design

### Selection Model

Each `PaneState` gains `selectionAnchor: string | null`. A selection helper accepts the current selected paths, anchor, visible order, target path, and mode:

- `single` replaces the set with the target and sets the target as anchor;
- `toggle` adds or removes the target and sets the target as anchor;
- `range` selects the inclusive ordered range and preserves the original anchor when it is valid, otherwise it falls back to `single`.

The helper returns both the next selected set and next anchor. Range lookup uses `visibleOrder`, which already tracks `FilePane` sorting, rather than raw API entry order.

Root changes, path changes, and selection-clearing operation completion clear the anchor. Entry refreshes clear an anchor that no longer exists in the visible entries. Sorting does not clear a still-visible anchor; subsequent Shift selection uses the new visible order.

### DualPane

`DualPane` owns the selection helper invocation and updates the selected set and anchor atomically. It exposes callbacks for:

- selecting one row with a resolved single, toggle, or range mode;
- replacing selected paths from a live marquee and clearing the anchor;
- retaining the existing select-all, checkbox, drag-start, and context-target flows.

Existing operations continue to consume `selected` and `visibleOrder`; the new anchor is interaction metadata and is never sent to the backend.

### FilePane Gesture Controller

On a primary-button press, `FilePane` first rejects checkboxes, buttons, the table header, resize separators, and other existing controls. If the origin is inside the icon-and-name activator, dnd-kit retains gesture ownership and row click selection is handled only if no drag activates.

For every other allowed origin, `FilePane` records a pending gesture containing:

- the initial client and list-content coordinates;
- the row path under the pointer, if any;
- the latest pointer coordinates;
- whether marquee activation has crossed the 4-pixel threshold;
- the last emitted ordered path list;
- the active animation-frame identifier.

Before the threshold is crossed, mouse release on a row emits one click-selection intent using the release event's Ctrl and Shift state. Mouse release on whitespace preserves the current no-op behavior. Once the threshold is crossed, the gesture becomes a marquee, the pending click is discarded, and selection is calculated continuously until release.

The controller owns document-level mouse-move and mouse-up listeners so selection continues when the pointer leaves the list. It also listens for window blur and provides an unmount cleanup path. Every completion or cancellation removes listeners, cancels animation frames, and clears the marquee box.

### Auto-Scroll And Geometry

An animation-frame loop runs only while a marquee is active and the pointer requests vertical scrolling. The top and bottom edge bands are approximately one compact row high. Velocity is proportional within the band and remains capped; no scrolling occurs when the list has no overflow or is already at the requested boundary.

The gesture start and current pointer are represented in list-content coordinates by combining client position with current scroll offsets. Row rectangles are converted to the same coordinate space before intersection checks. This keeps the marquee stable as `scrollTop` changes and allows rows above or below the viewport to remain part of the range.

After each effective pointer or scroll update, `FilePane` updates the marquee box and derives intersecting paths in current visible order. It emits only when the ordered path list changes.

### FileRow

`FileRow` exposes one row-selection callback carrying the entry path and modifier state. The row receives `aria-selected` from its existing `selected` prop.

The icon-and-name wrapper remains dnd-kit's only activator. A non-drag click from that wrapper emits the same selection intent as another row click. Checkbox pointer propagation remains blocked so checkbox toggling cannot also trigger row selection. Double-click continues to call the existing open behavior after the row has been selected.

## Data Flow

1. A primary-button gesture starts within a file pane.
2. An interactive control handles itself, the icon-and-name activator delegates movement to dnd-kit, and every other allowed location creates a pending click-or-marquee gesture.
3. Releasing a pending gesture on a row resolves modifiers and asks `DualPane` for a single, toggle, or range transition.
4. Crossing the movement threshold converts the gesture to a marquee, clears its pending click, and begins live intersection updates.
5. Entering the upper or lower edge band starts an animation-frame scroll loop. Every effective scroll recomputes content coordinates, the marquee box, and selected paths.
6. Mouse release commits the latest marquee selection, clears the anchor, stops auto-scroll, and removes global listeners.
7. File dragging continues through the existing dnd-kit path and never enters the marquee controller.

## Safety And Cleanup

- Only the primary mouse button can begin click or marquee selection.
- Interactive controls and the file drag activator remain excluded from marquee ownership.
- A gesture can transition from pending to marquee only once and cannot transition back to a click.
- An active file drag and an active marquee cannot coexist.
- Auto-scroll clamps to the list's valid scroll range and stops scheduling work once no further movement is possible.
- Mouse release, window blur, path or root navigation, and component unmount cancel listeners and animation frames.
- A missing list node or row node ends geometry work without throwing or changing filesystem state.
- Selection changes remain frontend-only until the user invokes an existing operation and confirms its preview.

## Accessibility

- Selected table rows expose `aria-selected="true"`; unselected rows expose `aria-selected="false"`.
- Existing labeled checkboxes remain the keyboard-accessible selection mechanism.
- Existing toolbar and context-menu commands remain keyboard accessible.
- No new visible instruction text, permanent handles, or cursor changes are introduced.
- File-drag announcements and operation-preview semantics remain unchanged.

## Testing

### Unit Tests

- Single selection replaces an existing set and updates the anchor.
- Ctrl toggle adds and removes paths while preserving other selections.
- Shift with no anchor falls back to one selected path and establishes an anchor.
- Repeated Shift clicks keep the original anchor and select inclusive ranges in both directions.
- Range selection follows current visible sorted order.
- An anchor missing from visible order falls back to ordinary single selection.
- Shift takes precedence when Ctrl and Shift are both present.

### Component Tests

- A row press and release below the threshold selects only that row.
- Movement beyond the threshold starts a marquee and suppresses row selection.
- A click on the icon-and-name activator selects the row, movement from it remains excluded from marquee selection, and its existing 6-pixel file-drag threshold remains intact.
- Checkbox clicks do not also trigger row selection.
- Selected rows expose correct `aria-selected` values.
- Marquee movement updates selected paths without duplicate emissions.
- Top- and bottom-edge motion changes `scrollTop`, includes newly reached rows, and stops at each boundary.
- Mouse release, blur, and unmount cancel active animation frames and document listeners.

### Browser Tests

- A long mocked directory can be marquee-selected beyond the initial viewport by holding the pointer near the bottom edge.
- Moving toward the top edge reverses scrolling and updates the selected range.
- Ordinary row clicks collapse selection, Ctrl-clicks add and remove entries, and Shift-clicks select inclusive sorted ranges.
- A first Shift-click without an anchor behaves as a single selection; keeping Shift held for a second click selects the range.
- Releasing Shift and clicking another row restores ordinary single selection.
- Existing icon-and-name file drag, checkbox, sorting, resizing, double-click navigation, media preview, context menu, and operation-preview scenarios remain green.

### Verification

Run focused selection and pane tests first, followed by the complete Vitest suite, ESLint, the type-checked production build, and the relevant Playwright flows with both short and long directory fixtures.

## Non-Goals

- Additive Ctrl+Shift range selection.
- Modifier-aware marquee selection.
- Keyboard arrow, Space, or Shift+Arrow row navigation.
- Touch marquee selection or touch-specific auto-scroll.
- Horizontal marquee auto-scroll.
- Changing file drag targets, operation defaults, operation previews, or backend filesystem behavior.
- Virtualizing the file table or redesigning its columns, density, checkboxes, or status bar.

## Acceptance Criteria

- Clicking any non-checkbox part of a row selects only that file or directory without preventing marquee selection from the approved row areas.
- Dragging beyond 4 pixels from a non-activator row area starts marquee selection and never produces a row click.
- Holding a marquee near the top or bottom edge scrolls the current pane and can select entries beyond the initially visible viewport.
- Ctrl-click toggles individual entries without clearing the rest of the selection.
- Shift-click selects every visible sorted entry between the established anchor and clicked endpoint; without an anchor, it behaves as a first single selection.
- Releasing Shift restores ordinary single-selection behavior for the next unmodified click.
- The icon-and-name region retains the existing file-drag workflow, while a short click there still selects its row.
- Checkbox, double-click, right-click, sorting, resizing, drag/drop, preview, and operation behavior remain functional.
