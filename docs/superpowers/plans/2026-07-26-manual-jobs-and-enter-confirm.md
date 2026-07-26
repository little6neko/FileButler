# Manual Jobs Sheet And Enter Confirmation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the Jobs sheet closed until explicitly requested and add guarded Enter confirmation to every approved file-operation dialog.

**Architecture:** Keep job lifecycle ownership in `DualPane` and remove only its automatic sheet-open transition. Add one local keyboard-event policy shared by the four confirmation dialogs; each dialog supplies the same enabled predicate and callback already used by its primary button, while child controls retain event priority.

**Tech Stack:** React 19, TypeScript 6, Base UI Dialog, local shadcn/ui components, Vitest, Testing Library, Playwright.

---

## File Structure

- Create `web/src/components/dialogConfirm.ts`: shared, dialog-local Enter policy.
- Create `web/src/components/dialogConfirm.test.tsx`: real React keyboard-event coverage for the shared policy.
- Modify `web/src/components/DualPane.tsx`: stop opening Jobs after job creation.
- Modify `web/src/components/DualPane.test.tsx`: cover closed-by-default Jobs behavior without weakening polling and refresh assertions.
- Modify `web/src/components/OperationPreview.tsx`: attach Enter confirmation and focus the popup content.
- Modify `web/src/components/OperationPreview.test.tsx`: cover ready and disabled Enter behavior.
- Modify `web/src/components/RenameDialog.tsx`: attach Enter confirmation without overriding preset selection.
- Modify `web/src/components/RenameDialog.test.tsx`: cover Enter submission, conflicts, and preset priority.
- Modify `web/src/components/SingleRenameDialog.tsx` and `web/src/components/SingleRenameDialog.test.tsx`: support Enter from the name input.
- Modify `web/src/components/MkdirDialog.tsx` and `web/src/components/MkdirDialog.test.tsx`: route existing Enter behavior through the shared policy.
- Modify `web/e2e/drag-drop-context-menu.spec.ts`: verify Base UI focus, Enter confirmation, and no automatic Jobs sheet in a real browser.

### Task 1: Keep The Jobs Sheet User-Controlled

**Files:**
- Modify: `web/src/components/DualPane.test.tsx:232-375`
- Modify: `web/src/components/DualPane.tsx:151-156`
- Test: `web/src/components/DualPane.test.tsx`

- [ ] **Step 1: Change integration expectations before production code**

In the PowerRename persistence and single-rename refresh tests, remove the two calls to `closeJobsSheet()`. In the terminal-refresh test, replace its close call with an assertion that no Jobs dialog opened:

```tsx
await waitFor(() => expect(api.opsCreateJob).toHaveBeenCalled());
expect(toast.success).toHaveBeenCalledWith("Background job created");
await waitFor(() => expect(api.job).toHaveBeenCalledWith("job-1"));
await waitFor(() => expect(api.browse).toHaveBeenCalledTimes(2));
expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument();
expect(within(leftPane).getByLabelText("Select source.txt")).not.toBeChecked();
```

Delete the now-unused helper:

```tsx
async function closeJobsSheet() {
  const sheet = await screen.findByRole("dialog", { name: "Jobs" });
  await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jobs" })).not.toBeInTheDocument());
}
```

Keep the existing `opens the jobs sheet from the workbench` test unchanged; it is the positive assertion for explicit opening.

- [ ] **Step 2: Run the focused test and verify the automatic sheet still appears**

Run from `web/`:

```bash
npm test -- --run src/components/DualPane.test.tsx
```

Expected: FAIL in `refreshes both panes after an operation job reaches a terminal status` because a dialog named `Jobs` is still present.

- [ ] **Step 3: Commit the red behavior test**

```bash
git add web/src/components/DualPane.test.tsx
git commit -m "test: cover manual jobs sheet behavior"
```

- [ ] **Step 4: Remove the automatic open transition**

Change `handleJobCreated` to:

```tsx
function handleJobCreated(id: string) {
  clearSelections();
  toast.success(labels.jobCreated);
  void refreshWhenJobFinishes(id);
}
```

Do not change `onJobsOpen={() => setJobsOpen(true)}`, `onOpenChange={setJobsOpen}`, polling, toast, selection clearing, or refresh behavior.

- [ ] **Step 5: Run the focused test and verify it passes**

```bash
npm test -- --run src/components/DualPane.test.tsx
```

Expected: all `DualPane` tests pass; the explicit Jobs-button test remains green.

- [ ] **Step 6: Commit the implementation**

```bash
git add web/src/components/DualPane.tsx
git commit -m "fix: keep jobs sheet user-controlled"
```

### Task 2: Add The Shared Dialog Enter Policy

**Files:**
- Create: `web/src/components/dialogConfirm.test.tsx`
- Create: `web/src/components/dialogConfirm.ts`
- Test: `web/src/components/dialogConfirm.test.tsx`

- [ ] **Step 1: Write failing tests against the desired helper**

Create `web/src/components/dialogConfirm.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { confirmDialogOnEnter } from "./dialogConfirm";

function Harness({
  enabled = true,
  onConfirm,
  preventInputEnter = false,
}: {
  enabled?: boolean;
  onConfirm(): void;
  preventInputEnter?: boolean;
}) {
  return (
    <div
      data-testid="dialog"
      tabIndex={-1}
      onKeyDown={(event) => confirmDialogOnEnter(event, enabled, onConfirm)}
    >
      <input
        aria-label="Name"
        onKeyDown={preventInputEnter ? (event) => event.preventDefault() : undefined}
      />
      <button type="button">Other action</button>
      <a href="#target">Link</a>
      <input type="checkbox" aria-label="Choice" />
      <input type="radio" aria-label="Mode" />
      <div role="option" tabIndex={0}>Preset option</div>
      <textarea aria-label="Notes" />
      <div aria-label="Editor" contentEditable tabIndex={0} />
    </div>
  );
}

it("confirms Enter from dialog content and text inputs", async () => {
  const onConfirm = vi.fn();
  render(<Harness onConfirm={onConfirm} />);

  screen.getByTestId("dialog").focus();
  await userEvent.keyboard("{Enter}");
  screen.getByLabelText("Name").focus();
  await userEvent.keyboard("{Enter}");

  expect(onConfirm).toHaveBeenCalledTimes(2);
});

it("ignores disabled, consumed, composing, repeated, and focused-button Enter", async () => {
  const onConfirm = vi.fn();
  const view = render(<Harness enabled={false} onConfirm={onConfirm} />);
  screen.getByLabelText("Name").focus();
  await userEvent.keyboard("{Enter}");

  view.rerender(<Harness onConfirm={onConfirm} preventInputEnter />);
  screen.getByLabelText("Name").focus();
  await userEvent.keyboard("{Enter}");

  view.rerender(<Harness onConfirm={onConfirm} />);
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Escape" });
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", isComposing: true });
  fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", repeat: true });

  for (const control of [
    screen.getByRole("button", { name: "Other action" }),
    screen.getByRole("link", { name: "Link" }),
    screen.getByRole("checkbox", { name: "Choice" }),
    screen.getByRole("radio", { name: "Mode" }),
    screen.getByRole("option", { name: "Preset option" }),
    screen.getByRole("textbox", { name: "Notes" }),
    screen.getByLabelText("Editor"),
  ]) {
    control.focus();
    await userEvent.keyboard("{Enter}");
  }

  expect(onConfirm).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

```bash
npm test -- --run src/components/dialogConfirm.test.tsx
```

Expected: FAIL because `./dialogConfirm` does not exist.

- [ ] **Step 3: Commit the red helper tests**

```bash
git add web/src/components/dialogConfirm.test.tsx
git commit -m "test: cover dialog enter confirmation"
```

- [ ] **Step 4: Implement the shared event policy**

Create `web/src/components/dialogConfirm.ts`:

```ts
import type { KeyboardEvent } from "react";

const specificControlSelector = [
  "button",
  "a[href]",
  "select",
  "textarea",
  "input[type='button']",
  "input[type='checkbox']",
  "input[type='radio']",
  "input[type='reset']",
  "input[type='submit']",
  "[role='button']",
  "[role='checkbox']",
  "[role='link']",
  "[role='option']",
  "[role='radio']",
  "[contenteditable]:not([contenteditable='false'])",
].join(",");

export function confirmDialogOnEnter(
  event: KeyboardEvent<HTMLElement>,
  enabled: boolean,
  confirm: () => void,
) {
  if (
    !enabled ||
    event.key !== "Enter" ||
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.repeat
  ) {
    return;
  }

  const target = event.target;
  if (target instanceof Element && target.closest(specificControlSelector)) return;

  event.preventDefault();
  confirm();
}
```

- [ ] **Step 5: Run helper tests**

```bash
npm test -- --run src/components/dialogConfirm.test.tsx
```

Expected: 2 tests pass with no unhandled event warnings.

- [ ] **Step 6: Commit the helper**

```bash
git add web/src/components/dialogConfirm.ts
git commit -m "feat: add dialog enter confirmation policy"
```

### Task 3: Confirm Common Operation Previews With Enter

**Files:**
- Modify: `web/src/components/OperationPreview.test.tsx`
- Modify: `web/src/components/OperationPreview.tsx`
- Test: `web/src/components/OperationPreview.test.tsx`

- [ ] **Step 1: Add ready and conflict Enter tests**

Append to `OperationPreview.test.tsx`:

```tsx
it("focuses the popup and creates a job with Enter when the preview is ready", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: false,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: false }],
  });
  vi.mocked(api.opsCreateJob).mockResolvedValue({ id: "job-enter" });
  const onJobCreated = vi.fn();
  render(<OperationPreview request={request()} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  const dialog = screen.getByRole("dialog", { name: "copy preview" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeEnabled());
  await waitFor(() => expect(dialog).toHaveFocus());
  await userEvent.keyboard("{Enter}");

  expect(api.opsCreateJob).toHaveBeenCalledWith(request());
  expect(onJobCreated).toHaveBeenCalledWith("job-enter");
});

it("ignores Enter while the operation preview has conflicts", async () => {
  vi.mocked(api.opsDryRun).mockResolvedValue({
    hasConflict: true,
    items: [{ sourcePath: "a.txt", destPath: "a.txt", conflict: true }],
  });
  render(<OperationPreview request={request()} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const dialog = screen.getByRole("dialog", { name: "copy preview" });
  await waitFor(() => expect(screen.getByRole("button", { name: "Start copy" })).toBeDisabled());
  dialog.focus();
  await userEvent.keyboard("{Enter}");

  expect(api.opsCreateJob).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run focused tests and verify Enter does not submit**

```bash
npm test -- --run src/components/OperationPreview.test.tsx
```

Expected: the ready Enter test fails because the popup is not the initial focus target and no job is created.

- [ ] **Step 3: Commit the red operation-preview tests**

```bash
git add web/src/components/OperationPreview.test.tsx
git commit -m "test: cover operation preview enter confirmation"
```

- [ ] **Step 4: Attach the shared policy and use one enabled predicate**

Add `useRef` and the helper imports:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmDialogOnEnter } from "./dialogConfirm";
```

Inside `OperationPreview`, add:

```tsx
const dialogRef = useRef<HTMLDivElement>(null);
```

After deriving `currentPreview`, `hasConflict`, and `error`, derive:

```tsx
const canConfirm = Boolean(currentPreview) && !currentPreview?.error && !hasConflict && !submitting;
```

Update the popup:

```tsx
<DialogContent
  ref={dialogRef}
  initialFocus={dialogRef}
  className="sm:max-w-3xl"
  showCloseButton={false}
  onKeyDown={(event) => confirmDialogOnEnter(event, canConfirm, () => void confirm())}
>
```

Use the same predicate on the primary button:

```tsx
disabled={!canConfirm}
```

- [ ] **Step 5: Run operation-preview and helper tests**

```bash
npm test -- --run src/components/OperationPreview.test.tsx src/components/dialogConfirm.test.tsx
```

Expected: all tests pass, including operation switching and stale dry-run coverage.

- [ ] **Step 6: Commit the operation-preview behavior**

```bash
git add web/src/components/OperationPreview.tsx
git commit -m "feat: confirm operation previews with enter"
```

### Task 4: Confirm PowerRename Without Overriding Presets Or Preview State

**Files:**
- Modify: `web/src/components/RenameDialog.test.tsx`
- Modify: `web/src/components/RenameDialog.tsx`
- Test: `web/src/components/RenameDialog.test.tsx`

- [ ] **Step 1: Add Enter submission and preset-priority coverage**

Append this ready-preview test:

```tsx
it("creates a PowerRename job with Enter from a text input", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  vi.mocked(api.renameCreateJob).mockResolvedValue({ id: "job-enter" });
  const onJobCreated = vi.fn();
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={onJobCreated} onClose={vi.fn()} />);

  const search = screen.getByLabelText("Search");
  await userEvent.type(search, "file");
  await waitFor(() => expect(api.renamePreview).toHaveBeenLastCalledWith(
    expect.objectContaining({ options: expect.objectContaining({ search: "file" }) }),
  ));
  await waitFor(() => expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeEnabled());
  await userEvent.keyboard("{Enter}");

  expect(api.renameCreateJob).toHaveBeenCalledWith(
    expect.objectContaining({ rootId: "data", paths: ["file.txt"] }),
  );
  expect(onJobCreated).toHaveBeenCalledWith("job-enter");
});
```

Append a loading-state test that leaves the initial preview unresolved:

```tsx
it("ignores Enter while the current PowerRename preview is loading", async () => {
  vi.mocked(api.renamePreview).mockReturnValue(new Promise<never>(() => undefined));
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  const search = screen.getByLabelText("Search");
  expect(screen.getByRole("button", { name: "Rename 1 item" })).toBeDisabled();
  await userEvent.type(search, "file{Enter}");

  expect(api.renameCreateJob).not.toHaveBeenCalled();
});
```

In the existing `creates a rename job from selected files` test, wait for the primary button to become enabled before clicking it:

```tsx
const renameButton = screen.getByRole("button", { name: "Rename 1 item" });
await waitFor(() => expect(renameButton).toBeEnabled());
await userEvent.click(renameButton);
```

In the existing `supports keyboard preset selection and Escape dismissal` test, clear the create-job mock before selecting the preset and add:

```tsx
expect(api.renameCreateJob).not.toHaveBeenCalled();
```

In `disables run button when preview has conflicts`, focus the search input, press Enter, and assert:

```tsx
expect(api.renameCreateJob).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run focused tests and verify Enter and loading guards are missing**

```bash
npm test -- --run src/components/RenameDialog.test.tsx
```

Expected: the ready Enter test fails because `renameCreateJob` is never called, and the loading-state test fails because the primary button is initially enabled; preset and conflict assertions remain green.

- [ ] **Step 3: Commit the red PowerRename test**

```bash
git add web/src/components/RenameDialog.test.tsx
git commit -m "test: cover PowerRename enter confirmation"
```

- [ ] **Step 4: Track whether the current options have a completed preview**

Add state next to the existing preview state:

```tsx
const [previewedOptions, setPreviewedOptions] = useState<RenameOptions | null>(null);
```

In the successful preview branch, record the exact options object captured by that request after updating the items and conflict state:

```tsx
setItems(plan.items);
setHasConflict(plan.hasConflict);
setError(null);
setPreviewedOptions(options);
```

In the failed preview branch, keep the current options unconfirmed:

```tsx
if (active) {
  setPreviewedOptions(null);
  setError(err instanceof Error ? err.message : labels.previewFailed);
}
```

Because every `update()` call creates a new `options` object, `previewedOptions === options` becomes false synchronously when a rule changes. An older async result records its older object and cannot enable submission for newer options.

- [ ] **Step 5: Attach the shared policy**

Import the helper:

```tsx
import { confirmDialogOnEnter } from "./dialogConfirm";
```

Derive the same state used by the primary button:

```tsx
const canSubmit = previewedOptions === options && !hasConflict && !submitting;
```

Attach it to `DialogContent`:

```tsx
onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, () => void run())}
```

Change the primary button to:

```tsx
<Button onClick={run} disabled={!canSubmit}>
```

Do not modify `PresetInput.handleKeyDown`; its highlighted Enter branch already calls `preventDefault()`, so it wins before the bubbled popup handler.

- [ ] **Step 6: Run PowerRename and helper tests**

```bash
npm test -- --run src/components/RenameDialog.test.tsx src/components/dialogConfirm.test.tsx
```

Expected: all tests pass; loading or stale previews cannot submit, and highlighted presets still populate the input without creating a job.

- [ ] **Step 7: Commit PowerRename behavior**

```bash
git add web/src/components/RenameDialog.tsx
git commit -m "feat: confirm PowerRename with enter"
```

### Task 5: Confirm Single Rename And New Folder With Enter

**Files:**
- Modify: `web/src/components/SingleRenameDialog.test.tsx`
- Modify: `web/src/components/SingleRenameDialog.tsx`
- Modify: `web/src/components/MkdirDialog.test.tsx`
- Modify: `web/src/components/MkdirDialog.tsx`
- Test: both dialog test files

- [ ] **Step 1: Change single rename to require Enter and add invalid-name coverage**

In the existing single-rename job test, replace the button click with:

```tsx
await userEvent.keyboard("{Enter}");
```

Append:

```tsx
it("ignores Enter when the new name is empty", async () => {
  render(<SingleRenameDialog rootId="root" path="old.txt" initialName="old.txt" onJobCreated={vi.fn()} onClose={vi.fn()} />);

  await userEvent.clear(screen.getByLabelText("New name"));
  await userEvent.keyboard("{Enter}");

  expect(api.singleRenameCreateJob).not.toHaveBeenCalled();
});
```

In `MkdirDialog.test.tsx`, change the existing primary-button click to:

```tsx
await userEvent.keyboard("{Enter}");
```

The mkdir test already passes before this task because that input has a local Enter handler; it protects the existing behavior while the implementation is moved to the shared policy.

- [ ] **Step 2: Run focused tests and verify only single rename fails**

```bash
npm test -- --run src/components/SingleRenameDialog.test.tsx src/components/MkdirDialog.test.tsx
```

Expected: single rename fails because no job is created; mkdir remains green.

- [ ] **Step 3: Commit the dialog tests**

```bash
git add web/src/components/SingleRenameDialog.test.tsx web/src/components/MkdirDialog.test.tsx
git commit -m "test: cover rename and mkdir enter confirmation"
```

- [ ] **Step 4: Attach the policy to single rename**

Import `confirmDialogOnEnter`, derive:

```tsx
const canSubmit = !submitting && newName.trim().length > 0;
```

Update `DialogContent`:

```tsx
<DialogContent
  className="sm:max-w-md"
  showCloseButton={false}
  onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, () => void submit())}
>
```

Use `disabled={!canSubmit}` on the Rename button.

- [ ] **Step 5: Route mkdir through the shared policy**

Import `confirmDialogOnEnter`, add this to `DialogContent`:

```tsx
onKeyDown={(event) => confirmDialogOnEnter(event, canSubmit, submit)}
```

Remove the input-local `onKeyDown` block so one Enter event cannot invoke `submit` twice.

- [ ] **Step 6: Run both focused suites**

```bash
npm test -- --run src/components/SingleRenameDialog.test.tsx src/components/MkdirDialog.test.tsx src/components/dialogConfirm.test.tsx
```

Expected: all tests pass; blank names remain blocked.

- [ ] **Step 7: Commit both implementations**

```bash
git add web/src/components/SingleRenameDialog.tsx web/src/components/MkdirDialog.tsx
git commit -m "feat: confirm rename and mkdir dialogs with enter"
```

### Task 6: Browser Acceptance And Complete Verification

**Files:**
- Modify: `web/e2e/drag-drop-context-menu.spec.ts`
- Verify: all modified frontend files and the approved design

- [ ] **Step 1: Extend the mocked API to record created operation jobs**

Change `installMockApi` to initialize and return both arrays:

```ts
const dryRuns: OpsPayload[] = [];
const createdJobs: OpsPayload[] = [];
```

In the `/api/ops/jobs` branch:

```ts
if (url.pathname === "/api/ops/jobs") {
  createdJobs.push(request.postDataJSON() as OpsPayload);
  return respond(route, { id: "job-1" });
}
```

Return:

```ts
return { dryRuns, createdJobs };
```

Update the first existing test to destructure `dryRuns`; calls that do not use either array may keep the returned object unused.

- [ ] **Step 2: Add a real-browser Enter and Jobs-sheet test**

Add:

```ts
test("confirms a ready operation with Enter without opening Jobs", async ({ page }) => {
  const { createdJobs } = await installMockApi(page);
  await page.goto("/");
  const left = page.getByRole("region", { name: "Left pane" });
  await expect(entryRow(left, "source.txt")).toBeVisible();

  await left.getByLabel("Select source.txt").click();
  await page.getByRole("button", { name: "Copy to right pane" }).click();
  const dialog = page.getByRole("dialog", { name: "copy preview" });
  await expect(dialog.getByRole("button", { name: "Start copy" })).toBeEnabled();
  await expect(dialog).toBeFocused();

  await page.keyboard.press("Enter");

  await expect.poll(() => createdJobs.length).toBe(1);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "Jobs" })).toHaveCount(0);
});
```

- [ ] **Step 3: Start the temporary frontend server**

From `web/`:

```bash
npm run dev -- --host 0.0.0.0 --port 8081
```

Keep the dedicated process only through Step 5.

- [ ] **Step 4: Run the focused Playwright file**

```bash
PLAYWRIGHT_BASE_URL=http://127.0.0.1:8081 npx playwright test e2e/drag-drop-context-menu.spec.ts
```

Expected: 3 browser tests pass, including popup initial focus, Enter submission, and a closed Jobs sheet.

- [ ] **Step 5: Stop the server and verify the port is closed**

Send Ctrl-C to the Vite process, then run:

```bash
ss -ltnp 'sport = :8081'
```

Expected: header only; no listener.

- [ ] **Step 6: Commit browser acceptance coverage**

```bash
git add web/e2e/drag-drop-context-menu.spec.ts
git commit -m "test: cover enter-confirmed operation workflow"
```

- [ ] **Step 7: Run the complete frontend verification**

From `web/`:

```bash
npm test -- --run
npm run lint
npm run build
```

Expected: every Vitest file passes, ESLint exits with no errors, TypeScript compiles, and Vite builds successfully. The existing chunk-size advisory is non-blocking.

- [ ] **Step 8: Check scope, whitespace, and repository state**

From the repository root:

```bash
git diff origin/main...HEAD --check
git status --short --branch
git log --oneline --decorate origin/main..HEAD
```

Expected: no whitespace errors, a clean worktree, and only the design, plan, focused tests, and implementation commits above `origin/main`.

- [ ] **Step 9: Review acceptance criteria**

Confirm directly in code and tests:

```text
job created -> toast, selection clear, polling, refresh; Jobs remains closed
Jobs button -> Jobs opens
ready common preview + Enter -> existing operation request
PowerRename input + Enter -> existing rename request
highlighted preset + Enter -> preset only
single rename/new folder + Enter -> existing submit callback
loading/conflict/invalid/submitting -> Enter ignored
media preview and non-dialog surfaces -> unchanged
```
