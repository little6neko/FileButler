# Windows-Style Selection Performance Design

Date: 2026-07-29

## Goal

Remove the remaining marquee-selection frame drops for panes containing hundreds to approximately one thousand entries, while preserving the existing UI and every click, modifier-selection, auto-scroll, context-menu, and file-drag behavior.

The design adopts the useful part of the Windows Explorer model: selection is stable list state, and a change invalidates only the entries whose selected bit changed. It does not attempt to copy Windows native controls or introduce table virtualization.

## Approved Scope

- Optimize the current 260-entry fixture and a deterministic 1,000-entry fixture.
- Keep live checkbox, row accessibility, selected-count, selected-byte, and toolbar feedback during marquee movement.
- Keep the existing 4-pixel marquee threshold and 6-pixel file-drag threshold.
- Keep current single-click, Ctrl, Shift, checkbox, sorting, auto-scroll, context-menu, and drag/drop semantics.
- Preserve selected-group drag order and unselected-entry drag behavior.
- Do not change visual styling, row height, scroll speed, operation previews, backend APIs, or filesystem behavior.
- Do not introduce a virtual list in this performance tier.

## Evidence And Root Cause

The first optimization already coalesces pointer work into animation frames, snapshots row geometry once, isolates marquee-box updates, memoizes FileRow, and removes per-row copies of the selected-path array.

Browser profiling with 260 entries showed:

- a box-only gesture with an unchanged selected path had a 16.8 ms P95 frame interval;
- a cross-row gesture had an approximately 50 ms P95 frame interval;
- selecting approximately 30 rows produced about 22,385 DOM mutation records;
- one initial selection update rewrote the hidden checkbox inputs for all 261 checkboxes in the pane, including 522 name mutations and 261 type mutations;
- script work dominated layout work during the slow gesture.

DualPane currently creates the PointerSensor options object inline. dnd-kit memoizes a sensor descriptor by the options object's identity, so every selection-driven DualPane render creates a new sensor descriptor and activator set. That changes dnd-kit's internal context. Every FileRow consumes that context through useDraggable and useDroppable, so the context update bypasses React.memo and rerenders every row. Base UI checkbox effects then rewrite hidden input attributes across the pane.

## Architecture

Implementation is benchmark-gated. Phase One removes the verified context cascade and applies small bounded hot-path improvements. Phase Two introduces a pane-local selection store only if Phase One fails the approved 260- and 1,000-entry performance thresholds.

### Phase One: Stable Drag Context

Move PointerSensor options to a module-level immutable constant. useSensor then receives the same options identity on every DualPane render, useSensors retains the same descriptor array, and dnd-kit's activators and internal context remain stable while selection changes.

Make the drag-source resolver stable. It reads the latest left and right PaneState values through refs, so accessibility announcements and drag-start handling use current selection and visible order without recreating the resolver on every selection update.

Memoize the announcements object and the DndContext accessibility object. This prevents selection-only renders from rebuilding the accessibility subtree and preserves the current selected-group count and first-entry announcement.

FileRow remains memoized. With the drag context stable, an unchanged row no longer rerenders merely because another row entered or left the marquee. Root, parent path, entry, selected state, labels, and drop feedback remain meaningful row inputs.

### Phase One: Bounded Marquee Work

Keep the cached row geometry in visible vertical order. Replace full-array filter and map operations with ordered range lookup:

1. Reject the selection when its horizontal interval has no positive overlap with the pane content range.
2. Locate the first row whose bottom edge is below the marquee top.
3. Locate the first row whose top edge is at or beyond the marquee bottom.
4. Return only the paths in that positive-overlap interval.

Binary search may be used because table rows are ordered and non-overlapping. Edge-only contact remains excluded exactly as it is now. Building the returned path list remains proportional to the number of selected entries, which is required for the authoritative selection update.

Move marquee-box position through translate3d and isolate its layout and paint with containment. Width and height continue representing the exact selection rectangle, and the existing border and fill remain unchanged. This is a secondary optimization; it must not alter geometry or stacking.

### Phase One: Render Containment

Selection remains authoritative in DualPane during Phase One. FilePane continues updating checkbox, aria-selected, pane status, and toolbar feedback live.

Selection-only updates may still execute the lightweight FilePane render and status calculation, but they must not propagate through dnd-kit or execute unchanged FileRow bodies. Selected count and byte total are derived in one pass over visible entries.

The inactive pane must not receive row-level DOM updates when selection changes only in the active pane.

## Performance Gate

Measure both 260-entry and 1,000-entry panes with ordinary marquee movement and edge auto-scroll in Chromium. Record frame intervals, long tasks, script/layout duration, row rectangle reads, and DOM mutation categories.

Phase One passes when all of the following hold on the local test environment:

- P95 frame interval is no greater than approximately 20 ms;
- frames above 32 ms are no more than 2 percent of sampled frames;
- no selection update rewrites hidden checkbox inputs for unchanged rows;
- each row rectangle is still read at most once per gesture;
- no selection-driven long task is attributable to a full list rerender;
- all interaction and drag/drop regression tests pass.

Timing assertions remain a local benchmark rather than a hard CI assertion because shared CI scheduling is nondeterministic. Deterministic CI coverage asserts stable sensor identities indirectly through bounded DOM mutations and unchanged-row behavior.

If Phase One passes, Phase Two is not implemented.

## Phase Two Fallback: Pane Selection Store

Phase Two is activated only if either fixture misses the performance gate after Phase One.

Create one stable selection store per pane. The store owns the selected-path set, Shift anchor, and current visible order, and exposes:

- getSnapshot for operation and drag consumers;
- replace, single, toggle, range, select-all, and clear transitions;
- a path-level subscription whose snapshot is one boolean;
- a summary subscription for selected count and selected bytes.

Each FileRow subscribes to only its own selected bit. Updating a marquee computes the symmetric difference between the previous and next sets and notifies only paths that were added or removed. Existing selected rows whose bit did not change receive no React update.

PaneStatusBar and the active ActionToolbar subscribe to the summary snapshot. Context menus, operation builders, rename flows, and drag-source resolution read the store snapshot at invocation time. This keeps all externally visible state live while removing the selected Set from DualPane's general render state.

Root changes, path changes, refresh pruning, completed operations, and explicit selection clearing update the store through the same transition API. Shift anchor rules remain identical to the existing pure selection helper.

## Data Flow

### Phase One

1. The marquee controller emits a changed ordered path list at most once per frame.
2. DualPane replaces the active pane's selected set.
3. DndContext receives stable sensors, resolver, and accessibility inputs, so its internal context does not change.
4. FilePane recomputes live summary values.
5. React.memo allows only rows whose selected prop changed to render.
6. Drag start resolves the latest selected group through the stable resolver and pane-state refs.

### Phase Two, If Required

1. The marquee controller sends the changed ordered path list to the active pane store.
2. The store computes added and removed paths and updates its authoritative snapshot.
3. Only affected path subscribers and summary subscribers are notified.
4. Operations and drag start read the same current store snapshot.

## Cleanup And Safety

- Stable refs are refreshed during React commit before browser events can consume them.
- A resolver never retains an obsolete root, path, entry list, selection set, or visible order.
- Selection-store subscriptions, if introduced, unsubscribe on row and pane unmount.
- Navigation clears active marquee listeners and invalidates the corresponding selection snapshot.
- Missing or removed paths are pruned without notifying unrelated rows.
- No optimization mutates filesystem state or bypasses operation confirmation.

## Testing

### Deterministic Tests

- Selection-only rerenders retain the same sensor descriptor and do not refresh dnd-kit consumers.
- One changed selected path updates only that row's aria-selected and checkbox state.
- Unchanged checkbox hidden inputs receive no name or type mutations.
- The inactive pane receives no row mutations from active-pane selection.
- Ordered hit testing preserves positive overlap, edge-only exclusion, reverse-direction selection, gaps, and auto-scrolled content coordinates.
- Stable drag resolution uses the latest selected paths and current visible order.
- Accessibility announcements preserve selected-group names and counts.
- Existing single, Ctrl, Shift, checkbox, context-menu, and drag/drop tests remain green.

If Phase Two is required, add pure store tests for path subscriptions, symmetric-difference notifications, summary snapshots, anchor behavior, pruning, and cleanup.

### Browser Verification

- Run 260- and 1,000-entry box-only, cross-row, and edge-auto-scroll scenarios.
- Verify checkbox, aria-selected, status, and toolbar feedback remain live.
- Verify selected-group and unselected-entry drags retain their current operation previews.
- Record local frame and DOM-mutation metrics before and after Phase One.
- Run the complete Playwright suite against a fresh database.

## Non-Goals

- Virtualizing table rows.
- Supporting tens of thousands of simultaneously rendered entries in this tier.
- Deferring visible selection until mouse release.
- Imperatively forcing controlled checkbox or aria state outside React.
- Changing selection semantics, drag targets, operation defaults, or visual design.

## Acceptance Criteria

- The 260- and 1,000-entry fixtures satisfy the Phase One performance gate, or Phase Two is implemented and then satisfies it.
- Selection updates do not invalidate dnd-kit's row consumers.
- Unchanged rows do not rewrite checkbox hidden-input attributes.
- Only changed rows and live summary consumers update during marquee movement.
- Existing UI, cursor, scrolling, selection, context-menu, accessibility, drag/drop, preview, and operation behavior remain unchanged.
