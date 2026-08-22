# Memory jobs and file authentication design

## Goal

Remove FileButler's SQL dependency completely, replace database-backed authentication with a fixed-size local authentication file and stateless signed cookies, and make the Jobs sheet show only active backend work plus terminal results retained by each currently open browser page.

The redesign must preserve background execution when browser pages close, while deliberately not preserving unfinished work across a FileButler service restart.

## Persistence boundary

FileButler will no longer open, create, read, migrate, or delete a SQL database.

Remove all SQL-backed concerns:

- users and sessions;
- jobs, job items, and the job event clock;
- audit records and the `/api/audit` endpoint;
- migrations and migration tests;
- database configuration and database test helpers;
- SQLite and its transitive Go dependencies.

The old `filebutler.db` is not imported, migrated, modified, or automatically removed. The operator will delete it manually.

## Authentication file

The existing first-run administrator setup page remains. Configuration replaces `database_path` with `auth_file`, defaulting to `./data/auth.json` and resolving relative paths against the configuration file directory.

On successful first-run setup, FileButler atomically creates an authentication file containing only:

- a format version;
- the administrator username;
- the existing Argon2id password hash;
- a randomly generated 32-byte session-signing key encoded for JSON storage.

The file is created with mode `0600`. Creation uses a same-directory temporary file, flushes and closes it before publication, and must not overwrite an authentication file won by a concurrent initialization request. FileButler loads it into memory at startup. A missing file means initialization is required. A malformed file, invalid hash, invalid signing key, unsupported version, or unreadable file is a startup error; FileButler must not silently reset authentication.

The file has fixed size with respect to login activity. It never contains browser sessions, so any number of logged-in browsers does not grow the file or create server-side session entries.

After upgrading, the old database administrator is not imported. If `auth.json` does not exist, the operator creates the administrator again through the initialization page.

## Stateless sessions

Login verifies the submitted username and password against the loaded authentication file. A successful login issues an HMAC-SHA256 signed HttpOnly cookie whose payload includes the administrator identity, authentication format/version marker, and expiration timestamp.

Session behavior is:

- fixed 24-hour lifetime from login;
- no sliding renewal;
- `SameSite=Lax`, `Path=/`, and the existing configurable `Secure` behavior;
- server-side validation on every protected request;
- logout deletes only the current browser's cookie;
- replacing the signing key invalidates every outstanding cookie.

No session list, revocation table, or per-browser state is written by the server.

## Backend job lifetime

Replace the SQL Job Store with a concurrency-safe in-memory job registry. The registry contains only nonterminal jobs and their current item results.

The existing operation and rename creation endpoints continue returning a job ID. The in-memory runner updates the registry for pending, running, cancel-requested, progress, and terminal transitions. It no longer writes audit records.

All terminal states are treated consistently:

- completed;
- completed with errors;
- failed;
- canceled.

At a terminal transition, the backend creates one final event containing the complete job and all item results. Appending that event to the replay buffer and removing the job from the active registry happen under the same synchronization boundary; subscriber notification follows. Therefore an already connected or validly reconnecting page can receive the final event, while a fresh page cannot retrieve completed work from the backend.

The service restart boundary is explicit: active operations are not restored or resumed after a FileButler process restart. An operation interrupted during process shutdown may have partially changed files.

## Job types and localization

Ordinary single-item rename jobs use type `rename`:

- English: `Rename`;
- Simplified Chinese: `重命名`.

PowerRename jobs use type `power_rename` and display `PowerRename` in both languages.

The two creation endpoints must assign their respective type before placing a job in the in-memory registry. Existing SQL records are irrelevant because they are not loaded.

## Event protocol

`GET /api/jobs/events` remains the source of job state. Its initial snapshot contains only active jobs, including all item results accumulated so far. This lets a page opened midway through an operation render complete current progress without querying history.

Incremental events carry the updated job and, when relevant, an item result. A terminal event carries the complete final detail as part of the atomic terminal transition described above.

Each service process has a runtime instance identifier and a monotonically increasing in-memory event cursor. Every snapshot and incremental event identifies both values, and the browser returns them when reconnecting. Snapshot creation and subscriber registration share the same synchronization boundary as registry updates so an update cannot be lost between those two actions.

A bounded in-memory event buffer supports automatic SSE reconnection from an already open page. This buffer is only for replay after a connection interruption:

- a new page without a previous cursor receives only the active snapshot;
- a reconnecting page may receive missed events, including a final event;
- no event is written to disk;
- the buffer has a fixed bound and cannot grow indefinitely.

If the supplied runtime identifier differs or the requested cursor has fallen outside the buffer, the server sends a reset snapshot instead of pretending replay is complete. On a reset, the page keeps its terminal records, replaces matching active records from the snapshot, adds newly active records, and marks any previously known nonterminal record absent from the snapshot as frontend-only `interrupted`. The same rule handles a process restart and an excessively long connection interruption without leaving a stale row permanently running.

The frontend no longer needs REST history or detail hydration. Remove `GET /api/jobs` and `GET /api/jobs/{id}` together with their unused client code. Keep `GET /api/jobs/events` and `POST /api/jobs/{id}/cancel`.

If the runtime instance identifier changes, an already open page keeps its known terminal history but converts any old nonterminal jobs missing from the new active snapshot to the frontend-only `interrupted` state. This prevents stale jobs from appearing to run forever after a service restart.

## Per-page task history

Every browser page owns an independent in-memory task store.

Lifecycle rules are:

- a page opened while a task is active receives it in the SSE snapshot;
- every page connected before completion receives and retains the terminal result;
- a page opened after completion never sees that task;
- closing and reopening the Jobs sheet does not clear anything;
- refreshing the page, closing the tab, or closing the browser destroys that page's terminal history;
- no `localStorage`, `sessionStorage`, IndexedDB, cookie, file, or backend terminal list persists task history.

Completed, completed-with-errors, failed, canceled, and interrupted records remain visible for the life of that page. Existing All, Running, and Completed filters continue to operate against this page-local state, with Completed covering every terminal state rather than only successful work.

## Inline cancellation control

An active job row contains two sibling interactive controls inside a relatively positioned visual row:

- the main task button fills the row and selects the task;
- a cancel icon button is absolutely positioned inside the right edge of the row, vertically centered, while the main content reserves enough right padding to avoid overlap.

The cancel control behaves as follows:

- pending and running jobs show a dark `X` icon;
- hovering the icon shows a neutral light-gray background similar to a file-row hover, with a darker pressed state and visible keyboard focus;
- the screenshot's red rectangle is an annotation and is not rendered;
- clicking the icon immediately requests cancellation without selecting the row or opening a confirmation dialog;
- after submission, the control is disabled and the job displays the cancel-requested state;
- cancel-requested jobs cannot submit a duplicate request;
- terminal jobs do not show the control;
- request failure restores the control and displays a row-level error without inventing a cancel-requested state;
- the icon has a localized accessible name and tooltip such as `取消移动任务`;
- the old detail-level Cancel button is removed.

The markup must not nest a button inside another button.

## Error handling

- Authentication file creation is atomic so a crash cannot leave a partially written credential file accepted as valid.
- Invalid authentication state fails closed.
- An unknown or already terminal job ID passed to cancel is handled idempotently without recreating history.
- Event reconnect uses the latest accepted cursor and ignores duplicate or older versions.
- A new active snapshot reconciles current active jobs while preserving terminal records already owned by that page.
- Backend restart is represented as interrupted work rather than silent success or permanent running state.

## Verification

Authentication tests cover initialization, file mode, atomic creation, malformed files, Argon2id verification, signed-cookie issuance, signature tampering, fixed expiration, logout, and multiple independent browser cookies without authentication-file growth.

Backend job tests cover concurrent registry access, atomic snapshot subscription, active-only snapshots, mid-job full details, progress events, cancellation, terminal event completeness, immediate active-registry removal, bounded reconnect replay, replay-buffer reset, fresh-page exclusion of terminal jobs, runtime instance changes, and distinct rename job types.

Frontend tests cover per-page terminal retention, snapshot reconciliation, terminal-state filters, refresh-equivalent store recreation, interrupted jobs, translated Rename and PowerRename labels, and the overlaid cancel control's click isolation, hover/focus classes, disabled state, and error recovery.

End-to-end verification covers:

1. start a long operation, close its creating page, and observe it from a newly opened page while still active;
2. keep multiple pages open through completion and verify each retains the final result;
3. refresh one page and verify completed history disappears there but remains in another unrefreshed page;
4. verify a page opened after completion has no completed history;
5. cancel from the overlaid `X` without selecting the row;
6. restart the service and verify old active rows become interrupted;
7. initialize and log in without creating or opening any SQL database.

Run all Go and frontend tests, lint, production builds, browser E2E tests, and real-service checks on the existing `0.0.0.0:8082` test deployment. Dependency and source scans must also confirm that SQLite drivers, SQL packages, migrations, database paths, and audit routes are gone and that normal startup does not create or open a database.

## Change organization

Implementation may be split into focused commits rather than one combined commit. Suitable boundaries include file-backed authentication, in-memory backend jobs and SQL removal, frontend per-page job state, and Jobs sheet cancellation/localization. Each commit must preserve unrelated worktree changes and be verified at an appropriate scope.
