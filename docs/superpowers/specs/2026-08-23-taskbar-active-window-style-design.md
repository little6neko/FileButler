# Taskbar Active Window Style Design

## Goal

Replace the taskbar's current combined gray fill and blue underline with a cleaner soft-blue capsule that identifies the selected window through one coherent visual treatment.

## Scope

- Apply the same selected style to active desktop-mode window buttons and the compact-mode File Manager button.
- Keep inactive, minimized, overflow, focus, and activation behavior unchanged.
- Do not change taskbar dimensions, button sizing, icons, titles, ordering, or window-management logic.

## Visual Treatment

The selected button uses a pale blue background, a subtle blue-gray border, dark blue text, a faint inset highlight, and a soft low-elevation shadow. It has no bottom indicator line. Hovering the selected button slightly deepens the blue background while preserving the selected appearance. Keyboard focus remains represented by the existing focus ring.

## Implementation

Both taskbar modes use the same neutral button variant. `aria-current="page"` remains the source of truth for selection and receives the capsule styling in `styles.css`. Desktop buttons continue to derive that attribute from the active, non-minimized window; compact mode continues to expose its sole File Manager button as current.

## Verification

Component and style tests verify that both modes use the common base variant, current buttons receive the capsule treatment without the old underline, and minimized or inactive windows do not become current. Existing window activation, taskbar interaction, unit, lint, build, and browser tests must remain green.
