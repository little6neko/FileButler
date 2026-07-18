# Windows-Style Directory Sorting Design

## Goal

Make each file pane group directories and non-directories like Windows Explorer while preserving the existing per-column sort controls and visible-order callbacks.

## Requirements

- Treat only entries whose `type` is `directory` as directories.
- Treat `file`, `symlink`, and `other` entries as non-directories.
- Keep directories before non-directories for every active sort except descending name order.
- When name order is descending (Z to A), keep non-directories before directories.
- Sort entries within each group by the active column and direction using the existing comparison rules.
- Preserve the initial name-ascending sort and the current click-to-toggle behavior.
- Keep `onVisibleOrderChange` aligned with the order rendered in the table so PowerRename receives the same order the user sees.

## Ordering Matrix

| Active sort | First group | Second group | Within-group order |
| --- | --- | --- | --- |
| Name ascending | Directories | Non-directories | Name A to Z |
| Name descending | Non-directories | Directories | Name Z to A |
| Type ascending or descending | Directories | Non-directories | Existing type comparison in the selected direction |
| Size ascending or descending | Directories | Non-directories | Existing size comparison in the selected direction |
| Modified ascending or descending | Directories | Non-directories | Existing modified-time comparison in the selected direction |

## Design

Keep sorting local to `FilePane`. In `sortEntries`, compare the directory group before comparing column values. The group comparison returns an order independent of the general ascending/descending multiplier: directories rank first by default, and non-directories rank first only when the active state is `{ column: "name", direction: "desc" }`.

When two entries belong to the same group, reuse `compareEntries` and apply the active direction exactly as today. This keeps natural name sorting, type/name tie-breaking, size/name tie-breaking, and modified/name tie-breaking unchanged within a group.

No backend, API type, component state, header interaction, or styling changes are required. `visibleEntries` remains the single rendered order and continues to drive `onVisibleOrderChange`.

## Testing

`FilePane` component tests will cover:

- Initial name-ascending order with directories before non-directories.
- Name-descending order with non-directories before directories and Z-to-A order inside both groups.
- A descending non-name column with directories still before non-directories.
- `symlink` and `other` entries remaining in the non-directory group.

The focused component test must fail before the implementation change and pass afterward. The complete frontend test suite, ESLint, production build, Go tests, and a Chromium interaction check will verify that the change does not regress visible ordering or table behavior.
