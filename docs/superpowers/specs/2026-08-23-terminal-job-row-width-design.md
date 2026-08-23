# Terminal Job Row Width Design

## Goal

Active jobs keep the overlaid cancel button and its reserved space. Once a job reaches any terminal state, the cancel button and its reserved space disappear so the labels and progress bar use the full task-row width.

## Behavior

- `pending`, `running`, and `cancel_requested` rows reserve space for the cancel button.
- `completed`, `completed_with_errors`, `failed`, `canceled`, and `interrupted` rows use normal, balanced horizontal padding.
- Existing row selection, cancellation, hover, focus, and error behavior remains unchanged.

## Implementation

`JobsSheet` derives the existing active-state condition once per row. Active rows add a `job-row-main--cancelable` modifier and continue rendering the sibling cancel button. The base `.job-row-main` rule uses balanced padding; the modifier applies the larger right padding needed by the overlaid button. No backend, event-store, or persistence changes are required.

## Verification

Component tests verify that active rows have the modifier and terminal rows do not have it or a cancel button. Style tests verify that only the modifier reserves the larger right-side space. Existing unit, lint, build, and task-sheet end-to-end tests must remain green.
