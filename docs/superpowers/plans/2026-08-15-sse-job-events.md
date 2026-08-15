# SSE Job Events Implementation Plan

**Goal:** Replace all task-status polling with a single authenticated SSE stream so file panes refresh immediately on terminal job state, while reconnect snapshots recover every state change missed during weak or interrupted network connections.

**Architecture:** SQLite remains authoritative. Every committed job mutation receives a persistent global event version and publishes a post-commit event to an in-process broker. An authenticated SSE endpoint sends a cursor-aware snapshot followed by live events. A single frontend task store owns `EventSource`, merges snapshots and live events by version, exposes jobs to the UI, and emits coalesced terminal-change notifications to the dual-pane browser.

**Tech Stack:** Go 1.26, chi, SQLite/modernc, React 19, TypeScript 6, native `EventSource`, Vitest, Testing Library.

---

### Task 1: Persist Job Event Versions

**Files:**
- Modify: `internal/store/migrations.go`
- Modify: `internal/store/store_test.go`
- Modify: `internal/jobs/types.go`
- Modify: `internal/jobs/store.go`
- Modify: `internal/jobs/store_test.go`

- [ ] Add migration 2 with `jobs.event_version` and the singleton `job_event_clock` row.
- [ ] Extend backend and frontend-facing job summaries with `eventVersion` and existing time/root fields needed by snapshots.
- [ ] Add transaction helpers that allocate a version, mutate one job, load the committed summary, commit, and only then publish.
- [ ] Make create, start, cancel request, item completion/progress, and finish use versioned transactions.
- [ ] Merge item-result insertion and progress increment into one transaction.
- [ ] Make terminal states immutable against late cancellation and make no-op conditional updates publish nothing.
- [ ] Add migration, version monotonicity, atomic item/progress, and terminal-race tests.

### Task 2: Add the In-Process Event Broker and Snapshot Queries

**Files:**
- Create: `internal/jobs/events.go`
- Create: `internal/jobs/events_test.go`
- Modify: `internal/jobs/store.go`
- Modify: `internal/jobs/store_test.go`

- [ ] Define `Event`, `Publisher`, broker subscription, and bounded subscriber channels.
- [ ] Broadcast committed events in order and close an overflowing subscription instead of dropping silently.
- [ ] Add a consistent snapshot query returning the event-version watermark, all active jobs, the latest 50 terminal jobs, and every job newer than a valid cursor.
- [ ] Deduplicate snapshot rows and keep stable newest-first ordering.
- [ ] Test broker ordering/unsubscribe/overflow and cursor-aware snapshot coverage beyond 50 terminal jobs.

### Task 3: Implement the Authenticated SSE Endpoint

**Files:**
- Modify: `internal/jobs/handlers.go`
- Modify: `internal/web/router.go`
- Modify: `internal/web/router_test.go`
- Modify: `cmd/filebutler/main.go`

- [ ] Construct one broker in `main`, attach it to the shared job store, runners, and router dependencies.
- [ ] Add protected `GET /api/jobs/events` routing.
- [ ] Subscribe before querying the snapshot, emit `retry: 2000`, `jobs.snapshot`, and then buffered versions above the snapshot watermark.
- [ ] Emit `job.changed` events and flush every event.
- [ ] Send a comment heartbeat every 15 seconds and stop cleanly on disconnect, write failure, or overflow.
- [ ] Set anti-buffering/cache headers and validate `Last-Event-ID` as a non-negative decimal integer.
- [ ] Test authentication, response headers, first snapshot, live delivery during snapshot setup, cursor compensation, and cleanup.

### Task 4: Adapt the Runner and Existing Handlers

**Files:**
- Modify: `internal/jobs/runner.go`
- Modify: `internal/jobs/runner_test.go`
- Modify: `internal/ops/handlers_test.go`
- Modify: `internal/rename/handlers_test.go`

- [ ] Replace separate item and progress writes with the atomic store operation.
- [ ] Preserve audit ordering and final status semantics.
- [ ] Ensure operation and rename job creation use the same broker-backed store as their runners.
- [ ] Add tests for emitted pending/running/progress/terminal sequences, partial failures, cancel, and late cancel against a terminal job.

### Task 5: Build the Frontend Task Event Store

**Files:**
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Create: `web/src/jobEvents.ts`
- Create: `web/src/jobEvents.test.ts`
- Create: `web/src/components/JobEventsProvider.tsx`
- Create: `web/src/components/JobEventsProvider.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`
- Modify: `web/src/test/setup.ts`

- [ ] Add typed `Job`, `JobItem`, snapshot, and changed-event payloads.
- [ ] Implement a normalized external store that merges by `eventVersion`, keeps all active plus 50 latest terminal jobs, and exposes connection state.
- [ ] Treat the first snapshot as a baseline; on reconnect compare it with retained versions and batch all newly observed terminal changes into one notification.
- [ ] Track created job IDs so a job completed before the create response cannot be missed or double-notified.
- [ ] Open exactly one native `EventSource` for the authenticated workspace and close it on unmount.
- [ ] Add tests for first snapshot, live progress, terminal dedupe, out-of-order events, reconnect compensation, more-than-50 compensation, and early completion.

### Task 6: Make DualPane Refresh Event-Driven

**Files:**
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/DualPane.test.tsx`

- [ ] Remove `refreshWhenJobFinishes`, terminal polling, and the delay helper.
- [ ] Register each newly created job with the shared task store.
- [ ] Subscribe to terminal-change batches and refresh both panes immediately.
- [ ] Serialize overlapping refresh batches with one pending-refresh flag and no timer.
- [ ] Preserve selection clearing, success toast, manual refresh, and jobs-sheet behavior.
- [ ] Test that progress does not browse, terminal state browses immediately once, reconnect batches browse once, and early completion is handled.

### Task 7: Make JobsSheet Event-Driven

**Files:**
- Modify: `web/src/components/JobsSheet.tsx`
- Modify: `web/src/components/JobsSheet.test.tsx`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/i18n.test.ts`

- [ ] Read the list, active count, progress, and status from the shared task store.
- [ ] Remove list and detail `setInterval` calls.
- [ ] Fetch selected detail once, merge subsequent item events, and refetch once when a reconnect snapshot shows the selected job advanced while disconnected.
- [ ] Render `JobItem` execution errors using result status/error fields.
- [ ] Show a restrained reconnecting label in the sheet description.
- [ ] Keep cancel as REST and wait for SSE to update its state.
- [ ] Rewrite component tests around event-store updates and assert that no periodic requests are scheduled.

### Task 8: Full Verification and Cleanup

**Files:**
- Verify: `internal/jobs/**`
- Verify: `internal/web/**`
- Verify: `web/src/jobEvents*`
- Verify: `web/src/components/DualPane.tsx`
- Verify: `web/src/components/JobsSheet.tsx`

- [ ] Run `gofmt` on changed Go files.
- [ ] Run all Go tests.
- [ ] Run focused frontend task-event, DualPane, JobsSheet, and App tests.
- [ ] Run all frontend tests and lint.
- [ ] Run the frontend production build.
- [ ] Search the codebase to confirm no periodic `/api/jobs` or `/api/jobs/{id}` polling remains.
- [ ] Run `git diff --check` and review the final diff for unrelated changes.
