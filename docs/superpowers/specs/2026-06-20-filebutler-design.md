# FileButler Design Plan

Date: 2026-06-20

## Goal

Build FileButler as a self-hosted file management tool for Docker or Linux local deployment. The first release focuses on a safe web-based dual-pane file manager and a PowerRename-style batch rename workflow.

The tool is designed for single-administrator use at first, while keeping account, actor, and audit boundaries ready for future multi-user permissions.

## References

- PowerRename feature reference: https://learn.microsoft.com/zh-cn/windows/powertoys/powerrename
- Windows logical string comparison reference: https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-strcmplogicalw

## Product Scope

### Included In The First Release

- Docker deployment.
- Linux local binary deployment.
- First-run administrator initialization with custom username and password.
- Administrator login after initialization.
- Multiple configured storage roots.
- Web UI with two file panes.
- Directory browsing inside configured roots only.
- Move, copy, soft link, hard link, directory creation, and delete operations.
- Dry-run preview for batch operations.
- Background job execution with progress, cancellation, failures, and audit logs.
- PowerRename-style batch rename workflow.
- Windows Explorer-style natural sorting for file lists, rename previews, enumeration, and execution order.
- SQLite persistence for account, session, job, audit, and undo metadata.

### Explicitly Out Of Scope For The First Release

- Multi-user permission management.
- Cloud storage providers.
- Full-text search.
- Media preview.
- Online file editing.
- High availability or multi-instance deployment.
- Windows and macOS local deployment support.

## Architecture

FileButler will be a single Go service with a React/Vite frontend.

The Go service provides:

- REST API.
- Authentication and session handling.
- File-system browsing and operations.
- Batch rename planning and execution.
- Background job execution.
- SQLite persistence.
- Static hosting for the built frontend assets.

The React frontend provides:

- Dual-pane file browsing.
- Selection and destination workflows.
- Batch operation dry-run previews.
- Batch rename rule editing and previews.
- Job progress and failure views.

This keeps deployment simple: one binary for local Linux deployment, and one container image for Docker deployment.

## Configuration

The service reads a configuration file on startup.

Core settings:

- Listen address.
- SQLite database path.
- Storage roots, each with a stable root id, display name, and absolute path.
- Job concurrency.
- Log level.
- Session cookie settings.

For Docker, storage roots are expected to map to mounted volumes. For local Linux deployment, roots are absolute paths in the host filesystem.

The frontend never sends trusted absolute paths. API requests identify files as `rootId + relativePath`. The backend resolves and validates all paths.

## First-Run Administrator Setup

When the SQLite database has no administrator account, the server enters initialization mode.

Initialization mode exposes only:

- Health check.
- Static frontend.
- Create administrator endpoint.

The administrator can choose a custom username and password. After the account is created, initialization mode closes permanently unless the database is reset manually.

Passwords are stored with a strong password hashing algorithm such as Argon2id or bcrypt. After login, the server issues a secure cookie-based session. Production deployment documentation should recommend HTTPS through a reverse proxy and warn against exposing the service directly to the public internet.

## Main Modules

### `auth`

Owns administrator initialization, login, logout, sessions, password hashing, and current actor lookup.

### `roots`

Owns configured storage roots, path normalization, relative path validation, absolute path resolution, and root boundary checks.

### `browser`

Owns directory listing, file metadata formatting, symlink metadata display, and natural sorting.

### `rename`

Owns PowerRename-style rule parsing, preview generation, conflict detection, enumeration order, execution planning, and undo metadata.

### `ops`

Owns file operations such as move, copy, delete, soft link creation, hard link creation, and directory creation.

### `jobs`

Owns dry-run plans, background execution, progress tracking, cancellation, failure records, and final job summaries.

### `audit`

Owns durable records of who performed which operation, at what time, on which source and destination paths.

### `web`

Owns REST routes, request validation, response shaping, error mapping, and static frontend serving.

## Dual-Pane File Manager

The main screen is a two-pane file manager. Each pane can choose any configured storage root and browse directories inside that root.

Each pane supports:

- Current root and path display.
- Directory navigation.
- File and folder selection.
- File metadata display.
- Natural sorting.
- Refresh.

Operations use one pane as the source and the other pane as the destination.

Supported first-release operations:

- Move selected items.
- Copy selected items.
- Create soft links in the destination.
- Create hard links in the destination.
- Create directory.
- Delete selected items.

Batch operations use the same flow:

1. User selects source items.
2. User chooses an operation and destination if needed.
3. Frontend sends a dry-run request.
4. Backend validates paths, evaluates conflicts and permissions, and returns an operation plan.
5. User confirms.
6. Backend creates a job and executes it in the background.
7. Frontend shows progress, failures, and final summary.

## Batch Rename Workflow

Batch rename is a separate workflow that can start from selected files or folders in either pane.

The first release should be as close as practical to PowerRename behavior, while improving ordering.

Supported options:

- Search text.
- Replacement text.
- Regular expression mode.
- Case-sensitive matching.
- Match all occurrences.
- Apply to file name, extension, or both.
- Include files.
- Include folders.
- Include subfolders.
- Enumerate items.
- Preview original and renamed values.
- Detect name conflicts before execution.
- Execute as a background job.
- Record undo metadata for reversible renames.

The rename preview must use the same operation plan that execution will use. If the preview shows a conflict or invalid target, execution must not silently produce a different result.

## Natural Sorting

FileButler must not use plain lexicographic ordering for file names. It should use Windows Explorer-style natural sorting.

Expected behavior:

- Split names into numeric and non-numeric segments.
- Compare non-numeric segments case-insensitively by default.
- Compare numeric segments by numeric value.
- Use stable tie-breakers for equal numeric values, such as original numeric width and full string comparison.

Example order:

```text
file1
file2
file02
file10
file100
```

This ensures `02` sorts before `100`, matching the user expectation from Windows Explorer and fixing the PowerRename ordering issue described during planning.

Natural sorting applies to:

- File list display.
- Batch rename preview.
- Batch rename enumeration.
- Batch rename execution order.
- Batch operation dry-run display where ordering matters.

## Job System

All batch operations are represented as jobs.

Job phases:

- Dry-run plan generation.
- Pending confirmation.
- Running.
- Cancel requested.
- Completed.
- Completed with failures.
- Failed.
- Canceled.

Each job stores:

- Job type.
- Actor id.
- Source root and paths.
- Destination root and path when applicable.
- Planned operations.
- Progress counters.
- Per-item result records.
- Error details.
- Undo metadata when available.
- Timestamps.

Cancellation is cooperative. It stops at safe checkpoints and does not imply rollback. Completed items remain completed and are clearly shown in the final result.

## Undo Policy

The first release supports undo only when it can be represented safely.

Undo candidates:

- Rename operations.
- Same-file-system moves.
- Soft links created by FileButler, if unchanged.
- Hard links created by FileButler, when the target can be identified safely.

Operations not guaranteed to support full undo:

- Copy operations.
- Cross-file-system moves, which may behave as copy plus delete.
- Jobs partially completed before cancellation.
- Targets modified externally after the job.

For non-undoable jobs, FileButler still records enough audit information for manual cleanup, such as target paths created by the operation.

## Conflict And Error Handling

The default conflict policy is conservative: do not overwrite existing files.

Dry-run detects:

- Existing destination paths.
- Missing source paths.
- Permission errors visible before execution.
- Root boundary violations.
- Symlink boundary problems.
- Cross-file-system hard link restrictions.
- Invalid rename results.
- Duplicate rename targets within the same batch.

Execution records structured errors per item:

- Source path.
- Destination path if applicable.
- Operation type.
- Error category.
- System error message.
- Suggested next action when useful.

## Symlink And Boundary Safety

Configured roots are the main security boundary.

The backend must:

- Clean relative paths.
- Resolve absolute paths.
- Reject `..` traversal outside the root.
- Verify resolved paths remain inside the configured root.
- Treat symlinks carefully during write operations.

Browsing may display symlink target metadata. Write operations must not follow a symlink if doing so would cause FileButler to operate outside configured roots.

## API Shape

Initial API groups:

- `GET /api/health`
- `GET /api/init/status`
- `POST /api/init/admin`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/roots`
- `GET /api/browse`
- `POST /api/ops/dry-run`
- `POST /api/ops/jobs`
- `POST /api/rename/preview`
- `POST /api/rename/jobs`
- `GET /api/jobs`
- `GET /api/jobs/{id}`
- `POST /api/jobs/{id}/cancel`
- `GET /api/audit`

The exact request and response schemas will be defined in the implementation plan.

## Persistence

SQLite stores:

- Administrator account.
- Sessions or session references.
- Storage root metadata snapshot.
- Jobs.
- Job item results.
- Audit records.
- Undo metadata.

Configured roots remain primarily configuration-driven, not user-created in the first release. The database may store root snapshots in job and audit records so historical logs remain understandable even if configuration changes later.

## Testing Strategy

### Unit Tests

- Natural sorting.
- Path normalization and root boundary checks.
- Rename rule parsing.
- Regex and non-regex replacement.
- Enumeration.
- Conflict detection.
- Undo plan generation.

### Integration Tests

Use temporary directories to verify:

- Browse behavior.
- Move jobs.
- Copy jobs.
- Soft link jobs.
- Hard link jobs.
- Delete jobs.
- Rename jobs.
- Job cancellation.
- Audit records.

### Frontend Tests

Cover:

- Dual-pane browsing.
- Selection behavior.
- Dry-run preview display.
- Rename preview display.
- Job progress display.
- Error and conflict states.

Use Playwright for core end-to-end flows once the frontend exists.

## Deployment

### Docker

The Docker image runs the Go service and serves the built frontend. Users mount host directories as configured storage roots and mount a persistent directory for the SQLite database.

### Linux Local

The local deployment uses the same binary and configuration file. Users configure absolute storage root paths and choose a database path.

## Open Design Decisions For Implementation Planning

These are intentionally deferred to the implementation plan:

- Exact Go router and middleware libraries.
- Exact SQLite migration tool.
- Whether job progress uses polling first or Server-Sent Events first.
- Exact frontend component library.
- Exact password hashing implementation.
- Exact conflict policy extensions after the conservative default.

