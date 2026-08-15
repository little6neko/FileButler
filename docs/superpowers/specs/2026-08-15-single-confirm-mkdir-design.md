# Single-Confirmation Folder Creation Design

## Goal

Create a folder immediately after the user confirms its name in the new-folder dialog. Remove the redundant operation-preview confirmation without changing confirmation behavior for copy, move, link, or delete operations.

## Interaction Flow

The user opens the new-folder dialog, enters a name, and clicks Confirm or presses Enter. The dialog trims the name and immediately requests creation of the `mkdir` job. It does not request a dry-run and does not open `OperationPreview`.

While the request is in progress, the input and dialog actions are disabled and the confirmation button displays a loading indicator. This prevents duplicate job creation from repeated clicks or Enter presses.

When job creation succeeds, the dialog closes and the existing `handleJobCreated` path registers the job with the job-event store, clears selection, and shows the existing success notification. The folder panes remain unchanged while the job is running and refresh through the existing SSE terminal event when the job finishes.

If job creation fails, the dialog stays open, preserves the entered name, and displays the returned error inside the dialog. The controls become available again so the user can edit the name and retry.

## Component Responsibilities

`MkdirDialog` continues to own the directory-name input and validation. Its `onSubmit` callback becomes asynchronous and returns only when the parent has either created the job or reported failure. The dialog owns submission state and presents errors, but it does not import the API client or know the active root and path.

`DualPane` builds the existing `OpsRequest` from the active pane and calls `api.opsCreateJob` directly:

```ts
{
  type: "mkdir",
  sourceRoot: activePane.rootId,
  sources: [],
  destRoot: activePane.rootId,
  destPath: activePane.path,
  newName: trimmedName,
}
```

On success, `DualPane` passes the returned job ID through `handleJobCreated`. The dialog is closed only after this succeeds. On failure, the asynchronous callback rejects so `MkdirDialog` can display the error and stay open.

The `createMkdirPreview` helper is removed because the normal new-folder flow no longer creates preview state. `OperationPreview` retains its existing `mkdir` compatibility code for now; this focused change does not alter or refactor the shared preview component.

## Unchanged Behavior

- Copy, move, symlink, hardlink, delete, and drag-and-drop operations still use `OperationPreview` and dry-run validation.
- Folder creation remains a background job rather than a synchronous filesystem API.
- Pane refresh remains event-driven: no polling and no refresh before the job reaches a terminal state.
- Existing name trimming and rejection of blank names remain in place.
- The API request schema and backend require no changes.

## Error Handling

The dialog uses the service error message when the rejected value is an `Error`; otherwise it uses the existing localized job-creation failure text. A new attempt clears the previous error before sending the request. Cancel remains available while idle and is disabled during submission so the in-flight request cannot leave the UI in an ambiguous state.

## Testing

- Update the `MkdirDialog` test to verify trimmed asynchronous submission, disabled controls and loading state while pending, and restored controls after completion.
- Add a failure test proving that the dialog remains visible, preserves the entered name, displays the error, and permits a successful retry.
- Update the `DualPane` integration test to assert that the first confirmation calls `api.opsCreateJob` with the active pane's `mkdir` request, does not call `api.opsDryRun`, does not open the operation-preview dialog, closes the name dialog after success, and registers the returned job.
- Keep existing operation-preview tests to guard all other operation types.
- Run the relevant component tests, the complete frontend test suite, lint, and a production build.

## Non-Goals

- Removing all `mkdir` support from `OperationPreview`.
- Changing backend job execution or SSE delivery.
- Adding optimistic folder rows before the job completes.
- Changing confirmation behavior for any operation other than new-folder creation.
