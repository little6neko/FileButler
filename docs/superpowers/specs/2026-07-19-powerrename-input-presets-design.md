# PowerRename Input Presets Design

Date: 2026-07-19

## Goal

Make common PowerRename expressions selectable directly from the Search and Replace inputs without changing the user's values until a preset is explicitly chosen.

## Approved Behavior

- The Search input offers one preset: `^.*`.
- The Replace input offers one preset: `${start=1,padding=3}`.
- Each preset list appears directly below its input and matches the input width.
- A list is visible only while its input is focused and its value is empty.
- Typing any character or selecting a preset hides the list.
- Deleting all characters while focus remains in the input shows the list again.
- Blurring the input closes the list. Clicking the same empty input again reopens it.
- Selecting a preset fills only that input. It does not automatically enable regular expressions or change any other PowerRename option.
- Presets are suggestions rather than defaults: opening PowerRename never inserts a value automatically.

## Component Design

`RenameDialog` will use a small rename-specific preset input helper for both controlled inputs. The helper receives the input ID, current value, change callback, and an array of preset strings. Keeping the preset arrays outside the renderer makes later additions a data-only change while avoiding a general-purpose abstraction before another consumer exists.

The helper owns only transient presentation state:

- whether the input currently has focus;
- whether the list was dismissed during the current focus session;
- which option is highlighted for keyboard navigation.

The actual text remains in `RenameDialog`'s existing `RenameOptions` state. Selecting or typing calls the same `update` function used today, so preview requests continue to be driven by the existing options effect.

The list is rendered only when the input is focused, its controlled value is empty, and it has not been dismissed. Preset selection uses pointer-down handling that prevents the input from blurring before the selection is applied. Once the value changes, the list disappears naturally.

## Interaction And Accessibility

- The input exposes combobox semantics and reports whether its listbox is expanded.
- The list uses `role="listbox"`; each preset uses `role="option"` and is associated with the existing localized field label.
- Pointer users select a preset by clicking its text row.
- Arrow Down and Arrow Up move the highlighted option.
- Enter selects the highlighted option.
- Escape closes the list for the current focus session. Refocusing or clicking the empty input reopens it.
- Tab follows normal focus order and closes the list when the input blurs.
- Hover, highlighted, and keyboard-focus states use the existing muted/accent colors. No instructional text is added to the application UI.

## Visual Design

- Keep the existing Search and Replace labels, input sizes, and spacing.
- Position each list immediately below its input with a small gap.
- Match the input width and use the existing border, background, compact radius, and popover shadow tokens.
- Render each preset as a single compact monospace row so expression punctuation is easy to scan.
- Keep the list above adjacent controls without changing the left options column width or dialog layout.

## Data Flow

1. Focusing or clicking an empty input opens its preset list without changing rename options or requesting a new preview.
2. Typing updates the corresponding controlled value through `update`, closes the list, and triggers the existing preview effect.
3. Selecting a preset sends the literal preset string through the same change callback, closes the list, and triggers one normal preview update.
4. Clearing the controlled value while focus remains in the input resets dismissal and shows the list again.
5. Closing PowerRename discards the helper's transient focus and highlight state with the rest of the dialog.

## Error Handling

Preset display and selection are entirely local and cannot fail independently. Existing preview request failures continue to use the current error banner. A rejected preview does not remove or alter the selected input value.

## Testing

Focused `RenameDialog` tests will verify:

- Presets are absent before an empty input receives focus.
- Focusing Search shows `^.*`; focusing Replace shows `${start=1,padding=3}`.
- Typing hides the open list.
- Clearing the focused input shows the list again.
- Clicking a preset fills the correct controlled input and closes the list.
- Blurring closes the list, and clicking the empty input reopens it.
- Keyboard highlighting and Enter selection work, while Escape dismisses the list.
- Selecting a preset continues to trigger the existing rename-preview request without changing unrelated options.
- Existing PowerRename rendering, localization, conflict, preview, and job-creation tests remain green.

## Non-Goals

- Persisting recent or custom presets.
- Letting users edit the preset collection in the UI.
- Automatically enabling regular expressions or enumeration options.
- Changing rename-expression parsing or backend APIs.
- Adding presets beyond the two approved initial values.
- Changing the PowerRename dialog layout or live-preview table.

## Acceptance Criteria

- Each approved literal can be selected from the correct empty, focused input.
- No preset is inserted until the user explicitly chooses it.
- Lists never remain visible while their input contains text or lacks focus.
- Clearing a focused input restores its list immediately.
- Pointer and keyboard selection both fill the input and preserve existing preview behavior.
- No backend or unrelated PowerRename behavior changes.
