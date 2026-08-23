# PowerRename Focus Ring Spacing Design

## Goal

Prevent the left edge of the focused Search and Replace input rings from being clipped in PowerRename.

## Root Cause

The PowerRename options column is a scrolling container with `overflow-auto`. Its content starts directly at the container's left edge, while the shared `Input` component draws a 3px focus ring outside its border. The scrolling container clips the part of that ring that extends beyond its left boundary.

The right side does not have the same issue because the options column already reserves right padding.

## Approved Fix

Add 4px of left padding to the existing PowerRename options column. This reserves enough room for the 3px focus ring without changing the shared `Input` component or the focus appearance.

Because compact and full modes both render `PowerRenameContent`, this one local change covers:

- The Search input.
- The Replace input.
- The compact-mode PowerRename dialog.
- The full-mode standalone PowerRename window.

## Behavior and Layout

- Input behavior, presets, keyboard handling, and rename preview requests remain unchanged.
- The options column remains scrollable.
- Its fixed grid width and right padding remain unchanged.
- The preview column and global input styles remain unchanged.

## Verification

- Add a component regression assertion that the options column reserves left focus-ring space.
- Run the focused PowerRename tests, the complete frontend test suite, lint, and production build.
- In a real browser, focus both Search and Replace in a standalone PowerRename window and confirm the input ring has visible clearance from the scrolling container's left edge.

## Non-goals

- Redesigning PowerRename controls.
- Changing focus-ring color, thickness, or radius.
- Modifying global input or scrolling-container styles.
