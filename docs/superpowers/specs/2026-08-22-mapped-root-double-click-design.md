# Mapped Root Double-Click Design

## Goal

Require a double-click to open mapped-root cards on the full-mode “All locations” page. A single pointer click must only focus the card, so the first click cannot replace the page and let a fast follow-up click land on a child folder.

## Scope

- Change only mapped-root cards rendered by `VirtualRootView`.
- Keep normal folder rows in full and compact modes unchanged; they already open on double-click through `FileRow`.
- Keep breadcrumb buttons, path controls, context menus, and drag-and-drop behavior unchanged.

## Interaction Design

Each mapped-root card remains a native button and a valid drop target.

- A pointer single-click focuses the card without opening it.
- A pointer double-click invokes `onOpenRoot` exactly once.
- Keyboard activation still opens the card. The click handler distinguishes keyboard-generated activation (`MouseEvent.detail === 0`) from pointer clicks, preserving both Enter and Space behavior without introducing a navigation delay.
- Pointer click handlers do not use a timeout. Navigation happens only from the `dblclick` event, eliminating the intermediate page change that causes accidental cross-directory entry.

## Components and Data Flow

`VirtualRootView.RootCard` owns the interaction rule. It continues receiving the existing `onOpen` callback from `VirtualRootView`; only the DOM event mapping changes:

1. Pointer clicks focus the native button but do not call `onOpen`.
2. A double-click calls `onOpen`.
3. A keyboard-generated click calls `onOpen`.
4. `VirtualRootView` forwards the selected root to the existing workspace navigation callback.

No window-manager, browser-session, selection, or backend changes are required.

## Error Handling

This change introduces no new asynchronous operation or error state. Existing root-opening and browse error handling remains responsible for navigation failures.

## Testing

Component coverage will verify that:

- one pointer click does not open a mapped root;
- a pointer double-click opens it exactly once;
- keyboard activation opens it;
- drop-target and context-menu behavior remain wired to the card.

Existing end-to-end scenarios that enter Data or Archive from “All locations” will use double-click. Existing `FilePane` coverage continues to verify double-click navigation for ordinary folders in both workspace modes.
