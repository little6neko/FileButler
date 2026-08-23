# Summary-Only Job Progress Design

## Goal

Keep FileButler's in-memory, SQL-free background jobs while preventing fast bulk operations from flooding the browser with per-file events. The Jobs sheet continues to show live aggregate progress and cancellation, but no longer stores, transmits, or renders per-file task details.

This design supersedes the per-item snapshot, incremental item event, terminal item list, and Jobs-sheet detail requirements in `2026-08-23-memory-jobs-file-auth-design.md`. Its active-only backend state and page-local terminal-history rules remain in force.

## Confirmed behavior

- PowerRename and other operations still use one creation request and receive one job ID. The request must still contain the selected paths and operation options; the response contains only the ID.
- The Jobs sheet displays task type, state, aggregate completed/total progress, percentage, failed-item count, a short error summary when available, and the active-task cancel control.
- Task rows are no longer selectable or clickable and do not expand into per-file details.
- The change applies to every task type, including copy, move, delete, mkdir, Rename, and PowerRename.
- Terminal summaries remain in the current page until refresh or closure. Fresh pages still receive only active tasks.
- No SQL, REST task history, persistent terminal history, artificial execution delay, or frontend storage is introduced.

## Backend job model

`Job` remains the complete public task representation and gains an aggregate failed-item count. The in-memory registry no longer retains `ItemResult` records. A job record may privately retain the first item error string so a terminal `completed_with_errors` summary can expose a useful short error without retaining paths or a result list.

After each executable item, the runner records aggregate progress:

- increment completed/processed count;
- increment failed count when execution failed;
- remember only the first item error message;
- continue honoring cancellation between items.

The existing executable plan remains private to the runner and is not exposed through task events. Removing result details does not change filesystem execution, conflict planning, or cancellation semantics.

## Event coalescing

Pending, running, cancel-requested, and terminal transitions publish immediately. Ordinary progress updates modify the active registry on every item but publish at most once per 100 milliseconds per job. A terminal transition always publishes the latest totals immediately, even when the last progress update was suppressed.

The coalescer does not use a timer that delays task execution. It compares the current time with the last published progress time when an item finishes. Therefore a task that completes in less than 100 milliseconds may move from running directly to its terminal 100% state, while longer tasks provide periodic live progress.

Snapshots contain the latest aggregate job values even if a progress event was coalesced. SSE events and replay entries contain only a job summary; the `item` and `items` payloads are removed. This keeps the subscriber queue and replay buffer comfortably below capacity during fast bulk work and prevents reconnect/reset loops caused by event bursts.

## Frontend state and Jobs sheet

The frontend event store retains only job summaries. It removes all item maps, sorting, detail hydration, and detail accessors. Existing reconciliation behavior remains: active snapshots update live work, terminal jobs stay page-local, runtime/reset gaps mark missing active work interrupted, and terminal listeners refresh visible directories once.

The Jobs sheet renders each task summary as a noninteractive visual row. Active rows keep the overlaid cancel button and its reserved space; terminal rows reclaim that space. The All, Running, and Completed filters remain. Failure information is aggregate only: the row shows the failed count and the job's short error message without naming individual files.

Because one terminal event is emitted and consumed once, a completed task requests one visible-directory refresh. The design must not refresh directories during per-item execution.

## Error and reconnect behavior

- A failed item contributes to both processed and failed totals; processing continues under the existing runner rules.
- A fatal runner/store error ends the job as failed and exposes its existing job-level error message.
- Cancellation publishes immediately and the terminal canceled summary reports the counts reached before cancellation.
- A valid SSE reconnect replays only coalesced summary events.
- A replay gap still produces an authoritative active-only reset; an absent locally active job becomes interrupted once.
- Removing per-file details means individual failed paths cannot be recovered from the Jobs sheet by design.

## Verification

Backend tests cover aggregate progress, failed counts and first-error summary, 100-millisecond coalescing, immediate state transitions, terminal total flushing, latest-progress snapshots, cancellation, bounded replay, and the absence of item payloads.

Frontend tests cover summary-only event storage, page-local terminal summaries, filters, failure summaries, static nonselectable task rows, cancellation isolation, and removal of all item-detail rendering.

A real browser test uses 300 empty files and PowerRename, then restores their original names. It verifies:

- all files are renamed successfully;
- the creation response and dialog close are not delayed by progress rendering;
- the Jobs sheet reaches the terminal aggregate state;
- no repeated browse `400` responses occur during execution;
- the previous approximately 1.1-second browser long task is eliminated;
- the test directory is restored after verification.

Run the complete Go tests (including race coverage for the job registry), frontend unit tests, lint, production build, and Playwright suite. The `0.0.0.0:8082` test service remains available with the rebuilt frontend after validation.
