# Input Underscore and PowerRename Scrolling Design

Date: 2026-07-31

## Goal

Prevent underscore glyphs from being clipped in compact text inputs, especially in Microsoft Edge, and expose a usable horizontal scrollbar at the visible bottom of the PowerRename live-preview area when long names overflow.

## Approved Behavior

- Underscores remain visibly distinct from spaces in every shared text input.
- Existing compact input height and horizontal spacing remain unchanged.
- Input text remains visually centered from 100% through 200% device scaling, including Windows at 150%.
- The PowerRename preview shows a horizontal scrollbar only when its table is wider than the preview viewport.
- The horizontal scrollbar belongs to the visible preview viewport, so it remains at the bottom of that viewport instead of appearing after the final table row.
- Native middle-button two-direction panning remains available in browsers that provide it.
- macOS trackpad horizontal, vertical, and diagonal scrolling works through the browser's native scrolling behavior.
- Native scrollbar visibility continues to respect operating-system settings, including macOS automatic scrollbar hiding.

## Input Design

The shared `Input` component keeps its existing `32px` height, border, radius, font sizes, and horizontal padding. It explicitly uses the bundled Geist variable font instead of inheriting the current `Inter`-first system fallback stack. This makes input glyph metrics deterministic on Windows, macOS, and Linux rather than allowing Windows to substitute Segoe UI.

The input keeps zero top padding and reserves `1px` at the bottom while retaining an explicit line height. In a fixed-height single-line input, this moves the visual text center upward by approximately `0.5px`. That difference is not visibly off-center at normal scaling, but at 150% device scaling it provides enough physical-pixel separation between the underscore stroke and Edge's native input clipping boundary. The outer dimensions and surrounding layout do not change.

The correction is made in the shared component rather than only in the single-file rename dialog. It therefore covers single rename, PowerRename search and replacement, pane paths, new-folder names, login, and administrator initialization consistently. Input values, selection, focus, keyboard handling, and submitted data remain unchanged.

## PowerRename Scrolling Design

The live-preview body becomes the sole native two-axis scroll container. The generic `Table` component gains an optional container-class override so this one preview can disable the table wrapper's nested horizontal scrolling while all other tables retain their current default behavior.

The preview table continues to use non-wrapping cells. When a long old or new name exceeds the available width, the table contributes its full width to the preview body's scrollable overflow. The preview body then supplies both axes of scrolling and places its horizontal scrollbar at the bottom edge of the visible body.

No custom `wheel`, pointer, touch, or middle-button handlers are added. Relying on native `overflow: auto` preserves browser middle-button panning, macOS trackpad gestures, momentum scrolling, diagonal movement, keyboard scrolling, and accessibility behavior without synchronizing multiple scroll positions.

## Component Boundaries

- `Input` owns the cross-browser vertical text metrics for all shared text inputs.
- `Table` keeps its existing default scroll wrapper and exposes only an optional styling hook for exceptional parent-owned scrolling.
- `RenameDialog` owns the PowerRename preview viewport and opts into parent-owned two-axis scrolling.
- Rename APIs, preview data, table columns, sorting, matching, and execution behavior are unchanged.

## Testing

Automated tests will verify:

- The shared input uses the bundled font and revised asymmetric vertical metrics while retaining its compact height.
- The PowerRename preview body is the two-axis overflow owner.
- The PowerRename table disables only its nested scroll wrapper; default tables remain unchanged.
- Long old and new names remain unwrapped and produce horizontal overflow.
- Existing PowerRename input, preview, Enter-to-confirm, and preset behavior remains green.

A Chromium browser matrix will render underscore-containing input values at device scale factors 1, 1.25, 1.5, 1.75, and 2. It will confirm that the input retains the exact value, uses Geist, keeps its `32px` CSS height, and remains visually centered with the underscore visibly separated from the lower clipping boundary. The long-name PowerRename check will confirm that the preview has `scrollWidth > clientWidth` and that changing the preview viewport's horizontal `scrollLeft` works. Because no wheel or pointer events are intercepted, native Edge middle-button panning and macOS trackpad scrolling remain browser-managed.

## Non-Goals

- Replacing native scrollbars with a custom scrollbar component.
- Forcing macOS to show scrollbars when the operating system is configured to hide them.
- Changing dialog size, preview columns, filename wrapping, or rename behavior.
- Changing the height or horizontal spacing of shared inputs.
- Changing typography outside shared input controls.

## Acceptance Criteria

- `_` is visible in compact inputs in Edge and Chromium-based browsers at 100%, 125%, 150%, 175%, and 200% scaling rather than appearing as a space.
- All shared inputs retain their current outer dimensions and behavior.
- Shared input text remains visually centered at each tested scaling level.
- A PowerRename preview with short names has no unnecessary horizontal scrollbar.
- A PowerRename preview with long names has a draggable horizontal scrollbar at the visible bottom of the preview viewport.
- Mouse-middle-button panning continues to work where supported by the browser.
- macOS trackpads can scroll the preview horizontally, vertically, and diagonally.
- Existing frontend tests, lint, and production build pass.
