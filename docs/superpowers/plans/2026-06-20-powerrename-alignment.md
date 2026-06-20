# PowerRename Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split ordinary single-item rename from batch PowerRename and implement PowerRename rename semantics aligned to Microsoft PowerToys.

**Architecture:** Keep the existing rename job executor and root-safety checks. Add a small ordinary rename request path for exactly one selected item, and replace the current simplified batch rename planner with a PowerRename compatibility planner that owns matching, replacement templates, transforms, timestamps, metadata extraction, preview conflicts, and job creation payloads.

**Tech Stack:** Go, chi HTTP handlers, SQLite job store, React, TypeScript, Vitest, Testing Library, CSS.

---

## File Structure

- Modify `web/src/components/DualPane.tsx`: toolbar gating for `Rename` and new `PowerRename`, modal selection, labels.
- Create `web/src/components/SingleRenameDialog.tsx`: ordinary single-item rename dialog.
- Rename `web/src/components/RenameDialog.tsx` to `web/src/components/PowerRenameDialog.tsx`: existing batch UI becomes PowerRename.
- Modify `web/src/api/types.ts`: add `SingleRenameRequest`, `PowerRenameOptions`, and keep JSON names compatible.
- Modify `web/src/api/client.ts`: add ordinary rename endpoint and rename batch methods to PowerRename names.
- Modify `web/src/i18n.ts`: add English and Simplified Chinese strings for `PowerRename`, ordinary rename, and PowerRename options.
- Modify `internal/rename/types.go`: add ordinary rename request/PowerRename option types and flags.
- Create `internal/rename/single.go`: ordinary single-item validation and plan construction.
- Create `internal/rename/powerrename.go`: PowerRename planner entry point.
- Create `internal/rename/powerrename_regex.go`: ECMAScript regex and PowerRename replacement-group behavior.
- Create `internal/rename/powerrename_tokens.go`: enumeration and random replacement token parser/renderer.
- Create `internal/rename/powerrename_transform.go`: uppercase/lowercase/titlecase/capitalized transforms.
- Create `internal/rename/powerrename_metadata.go`: timestamp and metadata template values.
- Create `internal/rename/powerrename_extract.go`: EXIF/XMP metadata extraction into PowerRename pattern names.
- Modify `internal/rename/handlers.go`: add ordinary rename handlers and route PowerRename preview/job through new planner.
- Modify `internal/web/router.go`: add ordinary rename route.
- Modify or add tests beside each changed file.

## Task 0: Preserve Current Baseline

**Files:**
- Inspect only: current modified files from the single-root UI work.

- [ ] **Step 1: Run current verification before starting**

Run:

```bash
npm --prefix web run test -- --run
npm --prefix web run build
go test ./...
```

Expected: all commands exit `0`.

- [ ] **Step 2: Commit current completed UI work if it is still uncommitted**

Run:

```bash
git status --short
git add web/src/components/DualPane.test.tsx web/src/components/DualPane.tsx web/src/components/FilePane.test.tsx web/src/components/FilePane.tsx web/src/components/JobsPanel.test.tsx web/src/components/JobsPanel.tsx web/src/components/OperationPreview.test.tsx web/src/components/OperationPreview.tsx web/src/components/RenameDialog.test.tsx web/src/components/RenameDialog.tsx web/src/i18n.ts web/src/styles.css
git commit -m "feat: refine single root pane operations"
```

Expected: only the already-completed single-root UI work is committed.

## Task 1: Ordinary Single-Item Rename Backend

**Files:**
- Create: `internal/rename/single.go`
- Modify: `internal/rename/handlers.go`
- Modify: `internal/web/router.go`
- Test: `internal/rename/single_test.go`
- Test: `internal/rename/handlers_test.go`

- [ ] **Step 1: Write failing ordinary rename planner tests**

Create `internal/rename/single_test.go`:

```go
package rename

import "testing"

func TestSingleRenamePlanRejectsMultiplePaths(t *testing.T) {
	_, err := BuildSinglePlan([]InputItem{{RelativePath: "a.txt"}, {RelativePath: "b.txt"}}, "next.txt", nil)
	if err == nil || err.Error() != "ordinary rename requires exactly one selected item" {
		t.Fatalf("err = %v", err)
	}
}

func TestSingleRenamePlanRejectsPathSeparators(t *testing.T) {
	_, err := BuildSinglePlan([]InputItem{{RelativePath: "a.txt"}}, "nested/b.txt", nil)
	if err == nil || err.Error() != "new name must not contain a path separator" {
		t.Fatalf("err = %v", err)
	}
}

func TestSingleRenamePlanBuildsOneItem(t *testing.T) {
	plan, err := BuildSinglePlan([]InputItem{{RelativePath: "folder/a.txt"}}, "b.txt", func(path string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if plan.HasConflict || len(plan.Items) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	item := plan.Items[0]
	if item.SourcePath != "folder/a.txt" || item.TargetPath != "folder/b.txt" || item.OldName != "a.txt" || item.NewName != "b.txt" || !item.Changed {
		t.Fatalf("item = %+v", item)
	}
}
```

- [ ] **Step 2: Verify planner tests fail**

Run:

```bash
go test ./internal/rename -run 'TestSingleRenamePlan' -v
```

Expected: FAIL because `BuildSinglePlan` is undefined.

- [ ] **Step 3: Implement ordinary rename planner**

Create `internal/rename/single.go`:

```go
package rename

import (
	"errors"
	"path/filepath"
	"strings"
)

var ErrSingleRenameSelection = errors.New("ordinary rename requires exactly one selected item")
var ErrSingleRenameEmptyName = errors.New("new name must not be empty")
var ErrSingleRenamePathSeparator = errors.New("new name must not contain a path separator")

func BuildSinglePlan(items []InputItem, newName string, existingTarget func(path string) bool) (PlanResult, error) {
	if len(items) != 1 {
		return PlanResult{}, ErrSingleRenameSelection
	}
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return PlanResult{}, ErrSingleRenameEmptyName
	}
	if strings.ContainsAny(newName, `/\`) {
		return PlanResult{}, ErrSingleRenamePathSeparator
	}
	item := items[0]
	dir := filepath.Dir(item.RelativePath)
	if dir == "." {
		dir = ""
	}
	oldName := filepath.Base(item.RelativePath)
	targetPath := newName
	if dir != "" {
		targetPath = filepath.ToSlash(filepath.Join(dir, newName))
	}
	planItem := PlanItem{
		SourcePath: item.RelativePath,
		TargetPath: targetPath,
		OldName:    oldName,
		NewName:    newName,
		Changed:    oldName != newName,
	}
	result := PlanResult{Items: []PlanItem{planItem}}
	if existingTarget != nil && targetPath != item.RelativePath && existingTarget(targetPath) {
		result.HasConflict = true
		result.Items[0].Conflict = true
		result.Items[0].ErrorCode = "target_exists"
		result.Items[0].ErrorText = "target already exists"
	}
	return result, nil
}
```

- [ ] **Step 4: Verify planner tests pass**

Run:

```bash
go test ./internal/rename -run 'TestSingleRenamePlan' -v
```

Expected: PASS.

- [ ] **Step 5: Add failing HTTP handler test**

Append to `internal/rename/handlers_test.go`:

```go
func TestSingleRenameCreateJobRejectsMultiplePaths(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actor := insertUser(t, db)
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "a.txt"), "x")
	testutil.WriteFile(t, filepath.Join(root, "b.txt"), "x")
	svc := browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}
	handler := SingleRenameCreateJobHandler(svc, jobs.Store{DB: db}, jobs.Runner{Store: jobs.Store{DB: db}, Audit: audit.Store{DB: db}, Executor: Executor{Resolver: svc.Resolver}})
	req := renameReq(SingleRenameRequest{RootID: "data", Paths: []string{"a.txt", "b.txt"}, NewName: "next.txt"})
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: actor, Username: "admin"}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}
```

- [ ] **Step 6: Verify handler test fails**

Run:

```bash
go test ./internal/rename -run TestSingleRenameCreateJobRejectsMultiplePaths -v
```

Expected: FAIL because `SingleRenameRequest` and `SingleRenameCreateJobHandler` are undefined.

- [ ] **Step 7: Implement ordinary rename HTTP handler and route**

Modify `internal/rename/handlers.go` to add:

```go
type SingleRenameRequest struct {
	RootID  string   `json:"rootId"`
	Paths   []string `json:"paths"`
	NewName string   `json:"newName"`
}

func SingleRenameCreateJobHandler(browser browser.Service, store jobs.Store, runner jobs.Runner) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req SingleRenameRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", "invalid JSON body")
			return
		}
		inputs, err := resolveRenameInputs(r.Context(), browser.Resolver, req.RootID, req.Paths)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		plan, err := BuildSinglePlan(inputs, req.NewName, existingPathFunc(browser.Resolver, req.RootID))
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
			return
		}
		if plan.HasConflict {
			writeData(w, http.StatusConflict, plan)
			return
		}
		createRenameJob(w, r, store, runner, req.RootID, plan)
	}
}
```

Refactor existing helper logic in `BuildPlan` and `CreateJobHandler` into these helpers in `handlers.go`:

```go
func resolveRenameInputs(ctx context.Context, resolver roots.Resolver, rootID string, paths []string) ([]InputItem, error) {
	inputs := make([]InputItem, 0, len(paths))
	for _, rel := range paths {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		resolved, err := resolver.Resolve(rootID, rel)
		if err != nil {
			return nil, err
		}
		info, err := os.Lstat(resolved.Abs)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, InputItem{RelativePath: rel, IsDir: info.IsDir()})
	}
	return inputs, nil
}

func existingPathFunc(resolver roots.Resolver, rootID string) func(path string) bool {
	return func(path string) bool {
		resolved, err := resolver.Resolve(rootID, filepath.ToSlash(path))
		if err != nil {
			return true
		}
		_, err = os.Lstat(resolved.Abs)
		return err == nil
	}
}

func createRenameJob(w http.ResponseWriter, r *http.Request, store jobs.Store, runner jobs.Runner, rootID string, plan PlanResult) {
	user, ok := auth.CurrentUser(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return
	}
	planJSON, _ := json.Marshal(plan)
	id := ops.NewJobID()
	if err := store.Create(r.Context(), jobs.Job{ID: id, Type: "rename", Status: jobs.StatusPending, ActorID: user.ID, SourceRootID: rootID, PlanJSON: string(planJSON), RootSnapshotJSON: "{}", ProgressTotal: len(plan.Items)}); err != nil {
		writeError(w, http.StatusInternalServerError, "operation_failed", err.Error())
		return
	}
	items := make([]jobs.ExecutableItem, 0, len(plan.Items))
	for i, item := range plan.Items {
		items = append(items, jobs.ExecutableItem{Index: i, Action: "rename", SourceRoot: rootID, SourcePath: item.SourcePath, DestRoot: rootID, DestPath: item.TargetPath, UndoJSON: "{}"})
	}
	go func() { _ = runner.Run(context.Background(), id, items) }()
	writeData(w, http.StatusCreated, map[string]string{"id": id})
}
```

Modify `internal/web/router.go` protected routes:

```go
protected.Post("/api/rename/single/jobs", rename.SingleRenameCreateJobHandler(deps.Browser, deps.JobStore, deps.RenameRunner))
```

- [ ] **Step 8: Verify handler tests pass**

Run:

```bash
go test ./internal/rename ./internal/web
```

Expected: PASS.

- [ ] **Step 9: Commit ordinary rename backend**

Run:

```bash
git add internal/rename internal/web/router.go
git commit -m "feat: add single item rename endpoint"
```

## Task 2: Ordinary Rename UI And Toolbar Gating

**Files:**
- Create: `web/src/components/SingleRenameDialog.tsx`
- Create: `web/src/components/SingleRenameDialog.test.tsx`
- Modify: `web/src/components/DualPane.tsx`
- Modify: `web/src/components/DualPane.test.tsx`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/i18n.ts`

- [ ] **Step 1: Add failing API/UI tests**

Append to `web/src/components/DualPane.test.tsx`:

```tsx
it("enables ordinary rename only for one selected item and keeps PowerRename for batch selection", async () => {
  vi.mocked(api.roots).mockResolvedValue([{ id: "root", name: "Root" }]);
  vi.mocked(api.browse).mockResolvedValue([
    { name: "a.txt", relativePath: "a.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
    { name: "b.txt", relativePath: "b.txt", type: "file", size: 1, mode: "", modifiedUnix: 0, isSymlink: false },
  ]);
  render(<DualPane />);

  const leftPane = await screen.findByRole("region", { name: "Left pane" });
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).toBeDisabled();

  await userEvent.click(within(leftPane).getByLabelText("Select a.txt"));
  expect(screen.getByRole("button", { name: "Rename" })).not.toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).not.toBeDisabled();

  await userEvent.click(within(leftPane).getByLabelText("Select b.txt"));
  expect(screen.getByRole("button", { name: "Rename" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "PowerRename" })).not.toBeDisabled();
});
```

Create `web/src/components/SingleRenameDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { SingleRenameDialog } from "./SingleRenameDialog";

vi.mock("../api/client", () => ({
  api: {
    singleRenameCreateJob: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.singleRenameCreateJob).mockReset();
});

it("creates a single rename job with the new basename", async () => {
  vi.mocked(api.singleRenameCreateJob).mockResolvedValue({ id: "job_1" });
  const onJobCreated = vi.fn();
  render(<SingleRenameDialog rootId="root" path="old.txt" initialName="old.txt" onJobCreated={onJobCreated} onClose={vi.fn()} />);

  await userEvent.clear(screen.getByLabelText("New name"));
  await userEvent.type(screen.getByLabelText("New name"), "new.txt");
  await userEvent.click(screen.getByRole("button", { name: "Rename" }));

  expect(api.singleRenameCreateJob).toHaveBeenCalledWith({ rootId: "root", paths: ["old.txt"], newName: "new.txt" });
  expect(onJobCreated).toHaveBeenCalledWith("job_1");
});
```

- [ ] **Step 2: Verify UI tests fail**

Run:

```bash
npm --prefix web run test -- --run src/components/DualPane.test.tsx src/components/SingleRenameDialog.test.tsx
```

Expected: FAIL because `PowerRename` and `SingleRenameDialog` do not exist.

- [ ] **Step 3: Add API types and client method**

Modify `web/src/api/types.ts`:

```ts
export type SingleRenameRequest = {
  rootId: string;
  paths: string[];
  newName: string;
};
```

Modify imports and `api` in `web/src/api/client.ts`:

```ts
import type { Entry, Job, OpsRequest, PlanItem, RenameRequest, Root, SingleRenameRequest } from "./types";

singleRenameCreateJob: (payload: SingleRenameRequest) =>
  request<{ id: string }>("/api/rename/single/jobs", { method: "POST", body: JSON.stringify(payload) }),
```

- [ ] **Step 4: Create `SingleRenameDialog`**

Create `web/src/components/SingleRenameDialog.tsx`:

```tsx
import { useState } from "react";
import { api } from "../api/client";
import { strings } from "../i18n";
import type { UIStrings } from "../i18n";
import { ErrorBanner } from "./ErrorBanner";

type Props = {
  rootId: string;
  path: string;
  initialName: string;
  onJobCreated(id: string): void;
  onClose(): void;
  labels?: UIStrings;
};

export function SingleRenameDialog({ rootId, path, initialName, onJobCreated, onClose, labels = strings.en }: Props) {
  const [newName, setNewName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const job = await api.singleRenameCreateJob({ rootId, paths: [path], newName });
      onJobCreated(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.renameFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <section className="modal single-rename-dialog" aria-label={labels.renameDialog}>
        <header className="modal-header">
          <h2>{labels.rename}</h2>
          <button type="button" onClick={onClose}>
            {labels.close}
          </button>
        </header>
        <ErrorBanner message={error} />
        <label className="single-rename-field">
          {labels.newName}
          <input value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus />
        </label>
        <footer className="modal-actions">
          <button type="button" onClick={submit} disabled={submitting || !newName.trim()}>
            {labels.rename}
          </button>
        </footer>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Add labels**

Modify `web/src/i18n.ts` `UIStrings`:

```ts
powerRename: string;
newName: string;
```

Add English strings:

```ts
powerRename: "PowerRename",
newName: "New name",
```

Add Simplified Chinese strings:

```ts
powerRename: "PowerRename",
newName: "新名称",
```

- [ ] **Step 6: Wire toolbar in `DualPane`**

Modify `web/src/components/DualPane.tsx`:

```tsx
const [singleRenameOpen, setSingleRenameOpen] = useState(false);
const [powerRenameOpen, setPowerRenameOpen] = useState(false);

<button type="button" onClick={() => setSingleRenameOpen(true)} disabled={activeSelection().length !== 1}>
  {labels.rename}
</button>
<button type="button" onClick={() => setPowerRenameOpen(true)} disabled={!activeSelection().length}>
  {labels.powerRename}
</button>
```

Replace the old batch rename modal condition with:

```tsx
{singleRenameOpen ? (
  <SingleRenameDialog
    rootId={activeState().rootId}
    path={activeSelection()[0]}
    initialName={basename(activeSelection()[0])}
    labels={labels}
    onClose={() => setSingleRenameOpen(false)}
    onJobCreated={() => {
      setSingleRenameOpen(false);
      setJobsOpen(true);
    }}
  />
) : null}
{powerRenameOpen ? (
  <RenameDialog
    rootId={activeState().rootId}
    paths={activeSelection()}
    labels={labels}
    onClose={() => setPowerRenameOpen(false)}
    onJobCreated={() => {
      setPowerRenameOpen(false);
      setJobsOpen(true);
    }}
  />
) : null}
```

Add helper:

```tsx
function basename(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
```

- [ ] **Step 7: Add CSS for single rename field**

Modify `web/src/styles.css`:

```css
.single-rename-field {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  font-size: 13px;
}

.single-rename-field input {
  min-height: 32px;
  border: 1px solid #c7d0d9;
  border-radius: 4px;
  padding: 0 8px;
}
```

- [ ] **Step 8: Verify UI tests pass**

Run:

```bash
npm --prefix web run test -- --run src/components/DualPane.test.tsx src/components/SingleRenameDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit ordinary rename UI**

Run:

```bash
git add web/src/components web/src/api web/src/i18n.ts web/src/styles.css
git commit -m "feat: add single item rename UI"
```

## Task 3: PowerRename Core Regex Compatibility

**Files:**
- Create: `internal/rename/powerrename_regex.go`
- Test: `internal/rename/powerrename_regex_test.go`
- Modify: `go.mod`

- [ ] **Step 1: Add dependency for ECMAScript-compatible regex**

Run:

```bash
go get github.com/dlclark/regexp2@latest
```

Expected: `go.mod` and `go.sum` update.

- [ ] **Step 2: Write failing regex compatibility tests**

Create `internal/rename/powerrename_regex_test.go`:

```go
package rename

import "testing"

func TestPowerRenameRegexReplacesFirstByDefault(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file-file.txt", "file", "doc", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc-file.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexReplacesAllWhenEnabled(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file-file.txt", "file", "doc", PowerRenameRegexOptions{MatchAll: true, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc-doc.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexIsCaseInsensitiveByDefault(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("File.txt", "file", "doc", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexSupportsECMAScriptLookahead(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file12.txt", `file(?=\d+)`, "doc", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc12.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}

func TestPowerRenameRegexReplacementGroups(t *testing.T) {
	got, matched, err := powerRenameRegexReplace("file12.txt", `file(\d+)`, "doc$1-$0", PowerRenameRegexOptions{MatchAll: false, CaseSensitive: false})
	if err != nil {
		t.Fatal(err)
	}
	if !matched || got != "doc12-file12.txt" {
		t.Fatalf("got=%q matched=%v", got, matched)
	}
}
```

- [ ] **Step 3: Verify regex tests fail**

Run:

```bash
go test ./internal/rename -run TestPowerRenameRegex -v
```

Expected: FAIL because `powerRenameRegexReplace` is undefined.

- [ ] **Step 4: Implement regex compatibility helper**

Create `internal/rename/powerrename_regex.go`:

```go
package rename

import (
	"strconv"
	"strings"

	"github.com/dlclark/regexp2"
)

type PowerRenameRegexOptions struct {
	MatchAll      bool
	CaseSensitive bool
}

func powerRenameRegexReplace(source, search, replace string, opts PowerRenameRegexOptions) (string, bool, error) {
	regexOpts := regexp2.ECMAScript
	if !opts.CaseSensitive {
		regexOpts |= regexp2.IgnoreCase
	}
	rx, err := regexp2.Compile(search, regexOpts)
	if err != nil {
		return "", false, err
	}
	var out strings.Builder
	pos := 0
	matched := false
	for {
		match, err := rx.FindStringMatch(source[pos:])
		if err != nil {
			return "", false, err
		}
		if match == nil {
			out.WriteString(source[pos:])
			break
		}
		matched = true
		start := pos + match.Index
		end := start + match.Length
		out.WriteString(source[pos:start])
		out.WriteString(expandPowerRenameReplacement(replace, match))
		pos = end
		if !opts.MatchAll {
			out.WriteString(source[pos:])
			break
		}
		if match.Length == 0 {
			if pos >= len(source) {
				break
			}
			out.WriteByte(source[pos])
			pos++
		}
	}
	return out.String(), matched, nil
}

func expandPowerRenameReplacement(template string, match *regexp2.Match) string {
	var out strings.Builder
	for i := 0; i < len(template); i++ {
		if template[i] != '$' || i+1 >= len(template) {
			out.WriteByte(template[i])
			continue
		}
		next := template[i+1]
		if next == '$' {
			out.WriteByte('$')
			i++
			continue
		}
		if next >= '0' && next <= '9' {
			idx, _ := strconv.Atoi(string(next))
			if group := match.GroupByNumber(idx); group != nil && group.Capture.String() != "" {
				out.WriteString(group.Capture.String())
			}
			i++
			continue
		}
		out.WriteByte(template[i])
	}
	return out.String()
}
```

- [ ] **Step 5: Verify regex tests pass**

Run:

```bash
go test ./internal/rename -run TestPowerRenameRegex -v
```

Expected: PASS.

- [ ] **Step 6: Commit regex compatibility layer**

Run:

```bash
git add go.mod go.sum internal/rename/powerrename_regex.go internal/rename/powerrename_regex_test.go
git commit -m "feat: add powerrename regex compatibility"
```

## Task 4: PowerRename Tokens And Transforms

**Files:**
- Create: `internal/rename/powerrename_tokens.go`
- Create: `internal/rename/powerrename_transform.go`
- Test: `internal/rename/powerrename_tokens_test.go`
- Test: `internal/rename/powerrename_transform_test.go`

- [ ] **Step 1: Write failing token tests**

Create `internal/rename/powerrename_tokens_test.go`:

```go
package rename

import (
	"regexp"
	"testing"
)

func TestPowerRenameEnumerationDefaultToken(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("photo-${}.jpg", 7, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || rendered != "photo-7.jpg" {
		t.Fatalf("rendered=%q changed=%v", rendered, changed)
	}
}

func TestPowerRenameEnumerationOptions(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("photo-${start=10;increment=2;padding=3}.jpg", 3, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || rendered != "photo-014.jpg" {
		t.Fatalf("rendered=%q changed=%v", rendered, changed)
	}
}

func TestPowerRenameRandomTokens(t *testing.T) {
	rendered, changed, err := renderPowerRenameTokens("${rstringalpha=3}-${rstringdigit=4}-${rstringalnum=5}-${ruuidv4}", 1, deterministicRandom{})
	if err != nil {
		t.Fatal(err)
	}
	if !changed {
		t.Fatal("expected random tokens to render")
	}
	if !regexp.MustCompile(`^[A-Za-z]{3}-[0-9]{4}-[A-Za-z0-9]{5}-[0-9a-fA-F-]{36}$`).MatchString(rendered) {
		t.Fatalf("rendered=%q", rendered)
	}
}
```

Create `internal/rename/powerrename_transform_test.go`:

```go
package rename

import "testing"

func TestPowerRenameTransforms(t *testing.T) {
	cases := []struct {
		name string
		fn   func(string) string
		want string
	}{
		{"upper", powerRenameUppercase, "HELLO WORLD"},
		{"lower", powerRenameLowercase, "hello world"},
		{"title", powerRenameTitlecase, "Hello World"},
		{"capitalized", powerRenameCapitalized, "Hello world"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.fn("hello WORLD"); got != tc.want {
				t.Fatalf("got=%q want=%q", got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Verify token and transform tests fail**

Run:

```bash
go test ./internal/rename -run 'TestPowerRename(Enumeration|Random|Transforms)' -v
```

Expected: FAIL because token and transform helpers are undefined.

- [ ] **Step 3: Implement tokens**

Create `internal/rename/powerrename_tokens.go` with parser/rendering for `${...}` tokens:

```go
package rename

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

type powerRenameRandom interface {
	alpha(int) string
	digit(int) string
	alnum(int) string
	uuidv4() string
}

type cryptoPowerRenameRandom struct{}
type deterministicRandom struct{}

func renderPowerRenameTokens(input string, itemIndex int, random powerRenameRandom) (string, bool, error) {
	if random == nil {
		random = cryptoPowerRenameRandom{}
	}
	var out strings.Builder
	changed := false
	for i := 0; i < len(input); {
		if !strings.HasPrefix(input[i:], "${") {
			out.WriteByte(input[i])
			i++
			continue
		}
		end := strings.Index(input[i+2:], "}")
		if end < 0 {
			out.WriteByte(input[i])
			i++
			continue
		}
		body := input[i+2 : i+2+end]
		value, ok, err := renderPowerRenameTokenBody(body, itemIndex, random)
		if err != nil {
			return "", false, err
		}
		if ok {
			out.WriteString(value)
			changed = true
		} else {
			out.WriteString("${")
			out.WriteString(body)
			out.WriteString("}")
		}
		i += end + 3
	}
	return out.String(), changed, nil
}

func renderPowerRenameTokenBody(body string, itemIndex int, random powerRenameRandom) (string, bool, error) {
	if body == "" || strings.Contains(body, "start=") || strings.Contains(body, "increment=") || strings.Contains(body, "padding=") {
		start, inc, padding := 1, 1, 0
		for _, part := range strings.Split(body, ";") {
			key, value, ok := strings.Cut(part, "=")
			if !ok || key == "" {
				continue
			}
			n, err := strconv.Atoi(value)
			if err != nil {
				return "", false, err
			}
			switch key {
			case "start":
				start = n
			case "increment":
				inc = n
			case "padding":
				padding = n
			}
		}
		n := start + ((itemIndex - 1) * inc)
		if padding > 0 {
			return fmt.Sprintf("%0*d", padding, n), true, nil
		}
		return strconv.Itoa(n), true, nil
	}
	if n, ok := tokenInt(body, "rstringalpha="); ok {
		return random.alpha(n), true, nil
	}
	if n, ok := tokenInt(body, "rstringdigit="); ok {
		return random.digit(n), true, nil
	}
	if n, ok := tokenInt(body, "rstringalnum="); ok {
		return random.alnum(n), true, nil
	}
	if body == "ruuidv4" {
		return random.uuidv4(), true, nil
	}
	return "", false, nil
}

func tokenInt(body, prefix string) (int, bool) {
	if !strings.HasPrefix(body, prefix) {
		return 0, false
	}
	n, err := strconv.Atoi(strings.TrimPrefix(body, prefix))
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

func (cryptoPowerRenameRandom) alpha(n int) string { return randomFromAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", n) }
func (cryptoPowerRenameRandom) digit(n int) string { return randomFromAlphabet("0123456789", n) }
func (cryptoPowerRenameRandom) alnum(n int) string { return randomFromAlphabet("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", n) }
func (cryptoPowerRenameRandom) uuidv4() string     { return uuid.NewString() }

func randomFromAlphabet(alphabet string, n int) string {
	var b strings.Builder
	for i := 0; i < n; i++ {
		idx, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		b.WriteByte(alphabet[idx.Int64()])
	}
	return b.String()
}

func (deterministicRandom) alpha(n int) string { return strings.Repeat("A", n) }
func (deterministicRandom) digit(n int) string { return strings.Repeat("1", n) }
func (deterministicRandom) alnum(n int) string { return strings.Repeat("B", n) }
func (deterministicRandom) uuidv4() string     { return "00000000-0000-4000-8000-000000000000" }
```

Run:

```bash
go get github.com/google/uuid@latest
```

- [ ] **Step 4: Implement transforms**

Create `internal/rename/powerrename_transform.go`:

```go
package rename

import (
	"strings"
	"unicode"
)

func powerRenameUppercase(input string) string {
	return strings.ToUpper(input)
}

func powerRenameLowercase(input string) string {
	return strings.ToLower(input)
}

func powerRenameTitlecase(input string) string {
	return strings.Title(strings.ToLower(input))
}

func powerRenameCapitalized(input string) string {
	lower := strings.ToLower(input)
	runes := []rune(lower)
	for i, r := range runes {
		if unicode.IsLetter(r) {
			runes[i] = unicode.ToUpper(r)
			break
		}
	}
	return string(runes)
}
```

- [ ] **Step 5: Verify token and transform tests pass**

Run:

```bash
go test ./internal/rename -run 'TestPowerRename(Enumeration|Random|Transforms)' -v
```

Expected: PASS.

- [ ] **Step 6: Commit tokens and transforms**

Run:

```bash
git add go.mod go.sum internal/rename/powerrename_tokens.go internal/rename/powerrename_tokens_test.go internal/rename/powerrename_transform.go internal/rename/powerrename_transform_test.go
git commit -m "feat: add powerrename templates and transforms"
```

## Task 5: PowerRename Planner Integration

**Files:**
- Modify: `internal/rename/types.go`
- Create: `internal/rename/powerrename.go`
- Test: `internal/rename/powerrename_test.go`
- Modify: `internal/rename/handlers.go`

- [ ] **Step 1: Add failing planner integration tests**

Create `internal/rename/powerrename_test.go`:

```go
package rename

import "testing"

func TestPowerRenamePlanUsesRegexTokensAndTransforms(t *testing.T) {
	opts := PowerRenameOptions{
		Search: "file(\\d+)",
		Replace: "photo-$1-${padding=2}",
		UseRegex: true,
		MatchAll: false,
		NameOnly: true,
		Uppercase: true,
	}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "file12.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) != 1 || plan.Items[0].NewName != "PHOTO-12-01.txt" {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPowerRenamePlanExtensionOnly(t *testing.T) {
	opts := PowerRenameOptions{Search: "jpeg", Replace: "jpg", MatchAll: false, ExtensionOnly: true}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "photo.jpeg"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "photo.jpg" {
		t.Fatalf("new name=%q", plan.Items[0].NewName)
	}
}

func TestPowerRenamePlanExcludesFolders(t *testing.T) {
	opts := PowerRenameOptions{Search: "a", Replace: "b", ExcludeFolders: true}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "a.txt"}, {RelativePath: "a-folder", IsDir: true}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) != 1 || plan.Items[0].SourcePath != "a.txt" {
		t.Fatalf("items=%+v", plan.Items)
	}
}
```

- [ ] **Step 2: Verify planner integration tests fail**

Run:

```bash
go test ./internal/rename -run TestPowerRenamePlan -v
```

Expected: FAIL because `PowerRenameOptions` and `PowerRenamePlan` are undefined.

- [ ] **Step 3: Add PowerRename option types**

Modify `internal/rename/types.go`:

```go
type PowerRenameOptions struct {
	Search            string `json:"search"`
	Replace           string `json:"replace"`
	UseRegex          bool   `json:"useRegex"`
	CaseSensitive     bool   `json:"caseSensitive"`
	MatchAll          bool   `json:"matchAll"`
	NameOnly          bool   `json:"nameOnly"`
	ExtensionOnly     bool   `json:"extensionOnly"`
	FullName          bool   `json:"fullName"`
	ExcludeFiles      bool   `json:"excludeFiles"`
	ExcludeFolders    bool   `json:"excludeFolders"`
	ExcludeSubfolders bool   `json:"excludeSubfolders"`
	Uppercase         bool   `json:"uppercase"`
	Lowercase         bool   `json:"lowercase"`
	Titlecase         bool   `json:"titlecase"`
	Capitalized       bool   `json:"capitalized"`
	EnumerateItems    bool   `json:"enumerateItems"`
	RandomizeItems    bool   `json:"randomizeItems"`
}
```

- [ ] **Step 4: Implement PowerRename planner**

Create `internal/rename/powerrename.go`:

```go
package rename

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/little6neko/filebutler/internal/natsort"
)

func PowerRenamePlan(items []InputItem, opts PowerRenameOptions, existingTarget func(path string) bool) (PlanResult, error) {
	filtered := filterPowerRenameItems(items, opts)
	sort.SliceStable(filtered, func(i, j int) bool {
		bi := filepath.Base(filtered[i].RelativePath)
		bj := filepath.Base(filtered[j].RelativePath)
		if bi != bj {
			return natsort.Less(bi, bj)
		}
		return filtered[i].RelativePath < filtered[j].RelativePath
	})
	result := PlanResult{Items: make([]PlanItem, 0, len(filtered))}
	targetIndexes := map[string][]int{}
	for i, item := range filtered {
		oldName := filepath.Base(item.RelativePath)
		newName, err := powerRenameName(oldName, opts, i+1)
		if err != nil {
			return PlanResult{}, err
		}
		dir := filepath.Dir(item.RelativePath)
		if dir == "." {
			dir = ""
		}
		targetPath := newName
		if dir != "" {
			targetPath = filepath.ToSlash(filepath.Join(dir, newName))
		}
		planItem := PlanItem{SourcePath: item.RelativePath, TargetPath: targetPath, OldName: oldName, NewName: newName, Changed: oldName != newName}
		if strings.ContainsAny(newName, `/\`) {
			planItem.Conflict = true
			planItem.ErrorCode = "invalid_name"
			planItem.ErrorText = "generated name contains a path separator"
			result.HasConflict = true
		} else if existingTarget != nil && targetPath != item.RelativePath && existingTarget(targetPath) {
			planItem.Conflict = true
			planItem.ErrorCode = "target_exists"
			planItem.ErrorText = "target already exists"
			result.HasConflict = true
		}
		targetIndexes[targetPath] = append(targetIndexes[targetPath], len(result.Items))
		result.Items = append(result.Items, planItem)
	}
	for _, indexes := range targetIndexes {
		if len(indexes) < 2 {
			continue
		}
		result.HasConflict = true
		for _, idx := range indexes {
			result.Items[idx].Conflict = true
			result.Items[idx].ErrorCode = "duplicate_target"
			result.Items[idx].ErrorText = "another item in this batch has the same target"
		}
	}
	return result, nil
}

func filterPowerRenameItems(items []InputItem, opts PowerRenameOptions) []InputItem {
	out := make([]InputItem, 0, len(items))
	for _, item := range items {
		if item.IsDir && opts.ExcludeFolders {
			continue
		}
		if !item.IsDir && opts.ExcludeFiles {
			continue
		}
		out = append(out, item)
	}
	return out
}

func powerRenameName(base string, opts PowerRenameOptions, itemIndex int) (string, error) {
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)
	extNoDot := strings.TrimPrefix(ext, ".")
	switch {
	case opts.ExtensionOnly:
		next, err := powerRenamePart(extNoDot, opts, itemIndex)
		if err != nil {
			return "", err
		}
		if next == "" {
			return name, nil
		}
		return name + "." + next, nil
	case opts.NameOnly:
		next, err := powerRenamePart(name, opts, itemIndex)
		if err != nil {
			return "", err
		}
		return next + ext, nil
	default:
		return powerRenamePart(base, opts, itemIndex)
	}
}

func powerRenamePart(input string, opts PowerRenameOptions, itemIndex int) (string, error) {
	replace := opts.Replace
	if opts.EnumerateItems || opts.RandomizeItems {
		rendered, _, err := renderPowerRenameTokens(replace, itemIndex, cryptoPowerRenameRandom{})
		if err != nil {
			return "", err
		}
		replace = rendered
	}
	var out string
	var err error
	if opts.Search == "" {
		out = input
	} else if opts.UseRegex {
		out, _, err = powerRenameRegexReplace(input, opts.Search, replace, PowerRenameRegexOptions{MatchAll: opts.MatchAll, CaseSensitive: opts.CaseSensitive})
		if err != nil {
			return "", err
		}
	} else {
		out = powerRenamePlainReplace(input, opts.Search, replace, opts.MatchAll, opts.CaseSensitive)
	}
	return applyPowerRenameTransforms(out, opts), nil
}

func powerRenamePlainReplace(input, search, replace string, matchAll bool, caseSensitive bool) string {
	if search == "" {
		return input
	}
	source := input
	needle := search
	if !caseSensitive {
		source = strings.ToLower(source)
		needle = strings.ToLower(needle)
	}
	if !matchAll {
		idx := strings.Index(source, needle)
		if idx < 0 {
			return input
		}
		return input[:idx] + replace + input[idx+len(search):]
	}
	var b strings.Builder
	for {
		idx := strings.Index(source, needle)
		if idx < 0 {
			b.WriteString(input)
			break
		}
		b.WriteString(input[:idx])
		b.WriteString(replace)
		input = input[idx+len(search):]
		source = source[idx+len(search):]
	}
	return b.String()
}

func applyPowerRenameTransforms(input string, opts PowerRenameOptions) string {
	switch {
	case opts.Uppercase:
		return powerRenameUppercase(input)
	case opts.Lowercase:
		return powerRenameLowercase(input)
	case opts.Titlecase:
		return powerRenameTitlecase(input)
	case opts.Capitalized:
		return powerRenameCapitalized(input)
	default:
		return input
	}
}
```

- [ ] **Step 5: Verify planner integration tests pass**

Run:

```bash
go test ./internal/rename -run TestPowerRenamePlan -v
```

Expected: PASS.

- [ ] **Step 6: Route existing batch handlers through PowerRename**

Modify `internal/rename/handlers.go` `BuildPlan` or add `BuildPowerRenamePlan` so the existing `/api/rename/preview` and `/api/rename/jobs` request path maps legacy `Options` to `PowerRenameOptions` until the frontend request type is renamed:

```go
func powerRenameOptionsFromLegacy(opts Options) PowerRenameOptions {
	return PowerRenameOptions{
		Search: opts.Search,
		Replace: opts.Replace,
		UseRegex: opts.UseRegex,
		CaseSensitive: opts.CaseSensitive,
		MatchAll: opts.MatchAll,
		NameOnly: opts.Target == "" || opts.Target == TargetName,
		ExtensionOnly: opts.Target == TargetExtension,
		FullName: opts.Target == TargetBoth,
		ExcludeFiles: !opts.IncludeFiles,
		ExcludeFolders: !opts.IncludeDirs,
		ExcludeSubfolders: !opts.IncludeSubfolders,
		EnumerateItems: opts.Enumerate,
	}
}
```

In `BuildPlan`, after resolving inputs, call:

```go
return PowerRenamePlan(inputs, powerRenameOptionsFromLegacy(req.Options), existingPathFunc(resolver, req.RootID))
```

- [ ] **Step 7: Verify rename package**

Run:

```bash
go test ./internal/rename
```

Expected: PASS.

- [ ] **Step 8: Commit planner integration**

Run:

```bash
git add internal/rename
git commit -m "feat: integrate powerrename planner"
```

## Task 6: Timestamp And Metadata Templates

**Files:**
- Create: `internal/rename/powerrename_metadata.go`
- Test: `internal/rename/powerrename_metadata_test.go`
- Modify: `internal/rename/powerrename.go`

- [ ] **Step 1: Add failing metadata rendering tests**

Create `internal/rename/powerrename_metadata_test.go`:

```go
package rename

import (
	"testing"
	"time"
)

func TestPowerRenameTimeTemplates(t *testing.T) {
	ctx := PowerRenameTemplateContext{
		CreationTime: time.Date(2026, 6, 20, 18, 7, 9, 0, time.UTC),
		ModifiedTime: time.Date(2026, 6, 21, 19, 8, 10, 0, time.UTC),
		AccessTime:   time.Date(2026, 6, 22, 20, 9, 11, 0, time.UTC),
	}
	got := renderPowerRenameMetadataTemplates("${creationtime:yyyy}-${modifiedtime:MM}-${accesstime:dd}", ctx)
	if got != "2026-06-22" {
		t.Fatalf("got=%q", got)
	}
}

func TestPowerRenameEXIFTemplates(t *testing.T) {
	ctx := PowerRenameTemplateContext{
		Metadata: map[string]string{
			"CAMERA_MODEL": "X100",
			"ISO":          "ISO 400",
			"WIDTH":        "6000",
		},
	}
	got := renderPowerRenameMetadataTemplates("${CAMERA_MODEL}-${ISO}-${WIDTH}", ctx)
	if got != "X100-ISO 400-6000" {
		t.Fatalf("got=%q", got)
	}
}
```

- [ ] **Step 2: Verify metadata tests fail**

Run:

```bash
go test ./internal/rename -run TestPowerRename.*Templates -v
```

Expected: FAIL because template context functions are undefined.

- [ ] **Step 3: Implement metadata template rendering**

Create `internal/rename/powerrename_metadata.go`:

```go
package rename

import (
	"regexp"
	"strings"
	"time"
)

type PowerRenameTemplateContext struct {
	CreationTime time.Time
	ModifiedTime time.Time
	AccessTime   time.Time
	Metadata     map[string]string
}

var powerRenameTemplateRegex = regexp.MustCompile(`\$\{([^}]+)\}`)

func renderPowerRenameMetadataTemplates(input string, ctx PowerRenameTemplateContext) string {
	return powerRenameTemplateRegex.ReplaceAllStringFunc(input, func(token string) string {
		body := strings.TrimSuffix(strings.TrimPrefix(token, "${"), "}")
		if value, ok := ctx.Metadata[body]; ok {
			return value
		}
		key, format, ok := strings.Cut(body, ":")
		if !ok {
			return token
		}
		switch strings.ToLower(key) {
		case "creationtime":
			return formatPowerRenameTime(ctx.CreationTime, format)
		case "modifiedtime":
			return formatPowerRenameTime(ctx.ModifiedTime, format)
		case "accesstime":
			return formatPowerRenameTime(ctx.AccessTime, format)
		default:
			return token
		}
	})
}

func formatPowerRenameTime(t time.Time, format string) string {
	replacer := strings.NewReplacer(
		"yyyy", "2006",
		"yy", "06",
		"MM", "01",
		"dd", "02",
		"HH", "15",
		"mm", "04",
		"ss", "05",
	)
	return t.Format(replacer.Replace(format))
}
```

- [ ] **Step 4: Connect metadata templates to PowerRename replacement rendering**

Modify `internal/rename/powerrename.go` `powerRenamePart` so metadata/time templates render before enumeration/random tokens:

```go
func powerRenamePart(input string, opts PowerRenameOptions, itemIndex int) (string, error) {
	replace := opts.Replace
	if opts.TemplateContext.Metadata != nil || !opts.TemplateContext.CreationTime.IsZero() || !opts.TemplateContext.ModifiedTime.IsZero() || !opts.TemplateContext.AccessTime.IsZero() {
		replace = renderPowerRenameMetadataTemplates(replace, opts.TemplateContext)
	}
	if opts.EnumerateItems || opts.RandomizeItems {
		rendered, _, err := renderPowerRenameTokens(replace, itemIndex, cryptoPowerRenameRandom{})
		if err != nil {
			return "", err
		}
		replace = rendered
	}
	var out string
	var err error
	if opts.Search == "" {
		out = input
	} else if opts.UseRegex {
		out, _, err = powerRenameRegexReplace(input, opts.Search, replace, PowerRenameRegexOptions{MatchAll: opts.MatchAll, CaseSensitive: opts.CaseSensitive})
		if err != nil {
			return "", err
		}
	} else {
		out = powerRenamePlainReplace(input, opts.Search, replace, opts.MatchAll, opts.CaseSensitive)
	}
	return applyPowerRenameTransforms(out, opts), nil
}
```

Add `TemplateContext PowerRenameTemplateContext` to `PowerRenameOptions` in `internal/rename/types.go`. The HTTP planner will populate this per item in Task 7.

- [ ] **Step 5: Verify metadata tests pass**

Run:

```bash
go test ./internal/rename -run TestPowerRename.*Templates -v
```

Expected: PASS.

- [ ] **Step 6: Commit timestamp and template support**

Run:

```bash
git add internal/rename/powerrename_metadata.go internal/rename/powerrename_metadata_test.go
git commit -m "feat: add powerrename metadata templates"
```

## Task 7: EXIF And XMP Metadata Extraction

**Files:**
- Create: `internal/rename/powerrename_extract.go`
- Test: `internal/rename/powerrename_extract_test.go`
- Modify: `internal/rename/types.go`
- Modify: `internal/rename/handlers.go`
- Modify: `go.mod`

- [ ] **Step 1: Add failing metadata extraction tests**

Create `internal/rename/powerrename_extract_test.go`:

```go
package rename

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExtractPowerRenameXMPPatterns(t *testing.T) {
	raw := []byte(`<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmp:CreatorTool="FileButlerTest" xmp:CreateDate="2026-06-20T18:07:09Z" xmpMM:DocumentID="doc-1"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Summer</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Alice</rdf:li></rdf:Seq></dc:creator><xmpRights:WebStatement>Copyright Alice</xmpRights:WebStatement></rdf:Description></rdf:RDF></x:xmpmeta>`)
	patterns := extractPowerRenameXMPPatterns(raw)
	if patterns["CREATOR_TOOL"] != "FileButlerTest" || patterns["TITLE"] != "Summer" || patterns["AUTHOR"] != "Alice" || patterns["COPYRIGHT"] != "Copyright Alice" || patterns["DOCUMENT_ID"] != "doc-1" {
		t.Fatalf("patterns=%+v", patterns)
	}
	if patterns["CREATE_DATE_YYYY"] != "2026" || patterns["CREATE_DATE_MM"] != "06" || patterns["CREATE_DATE_DD"] != "20" {
		t.Fatalf("date patterns=%+v", patterns)
	}
}

func TestBuildPowerRenameTemplateContextUsesFileTimes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "photo.jpg")
	if err := os.WriteFile(path, []byte("not an image"), 0o644); err != nil {
		t.Fatal(err)
	}
	mod := time.Date(2026, 6, 20, 18, 7, 9, 0, time.UTC)
	if err := os.Chtimes(path, mod, mod); err != nil {
		t.Fatal(err)
	}
	ctx := buildPowerRenameTemplateContext(path)
	if ctx.ModifiedTime.IsZero() || ctx.AccessTime.IsZero() {
		t.Fatalf("ctx=%+v", ctx)
	}
}
```

- [ ] **Step 2: Verify extraction tests fail**

Run:

```bash
go test ./internal/rename -run 'TestExtractPowerRenameXMPPatterns|TestBuildPowerRenameTemplateContextUsesFileTimes' -v
```

Expected: FAIL because extraction functions are undefined.

- [ ] **Step 3: Add extraction dependencies**

Run:

```bash
go get github.com/rwcarlsen/goexif/exif@latest
```

Expected: `go.mod` and `go.sum` update. XMP extraction uses Go's standard `encoding/xml` because PowerRename's exposed XMP pattern names are simple string/date fields.

- [ ] **Step 4: Implement metadata extraction**

Create `internal/rename/powerrename_extract.go`:

```go
package rename

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"strings"
	"syscall"
	"time"

	"github.com/rwcarlsen/goexif/exif"
)

func buildPowerRenameTemplateContext(absPath string) PowerRenameTemplateContext {
	info, err := os.Stat(absPath)
	ctx := PowerRenameTemplateContext{Metadata: map[string]string{}}
	if err == nil {
		ctx.ModifiedTime = info.ModTime()
		ctx.CreationTime = info.ModTime()
		ctx.AccessTime = info.ModTime()
		if stat, ok := info.Sys().(*syscall.Stat_t); ok {
			ctx.AccessTime = time.Unix(stat.Atim.Sec, stat.Atim.Nsec)
			ctx.CreationTime = time.Unix(stat.Ctim.Sec, stat.Ctim.Nsec)
		}
	}
	if file, err := os.Open(absPath); err == nil {
		defer file.Close()
		if exifPatterns := extractPowerRenameEXIFPatterns(file); len(exifPatterns) > 0 {
			for key, value := range exifPatterns {
				ctx.Metadata[key] = sanitizePowerRenameMetadataValue(value)
			}
		}
	}
	if raw, err := os.ReadFile(absPath); err == nil {
		for key, value := range extractPowerRenameXMPPatterns(raw) {
			ctx.Metadata[key] = sanitizePowerRenameMetadataValue(value)
		}
	}
	return ctx
}

func extractPowerRenameEXIFPatterns(reader io.Reader) map[string]string {
	x, err := exif.Decode(reader)
	if err != nil {
		return map[string]string{}
	}
	out := map[string]string{}
	exifString := func(name exif.FieldName, key string) {
		tag, err := x.Get(name)
		if err == nil {
			out[key] = strings.Trim(tag.String(), "\"")
		}
	}
	exifString(exif.Make, "CAMERA_MAKE")
	exifString(exif.Model, "CAMERA_MODEL")
	exifString(exif.LensModel, "LENS")
	exifString(exif.Artist, "AUTHOR")
	exifString(exif.Copyright, "COPYRIGHT")
	if tag, err := x.Get(exif.ISOSpeedRatings); err == nil {
		out["ISO"] = "ISO " + strings.Trim(tag.String(), "\"")
	}
	if lat, long, err := x.LatLong(); err == nil {
		out["LATITUDE"] = fmt.Sprintf("%.6f", lat)
		out["LONGITUDE"] = fmt.Sprintf("%.6f", long)
	}
	if tm, err := x.DateTime(); err == nil {
		addPowerRenameDateParts(out, "DATE_TAKEN", tm)
	}
	return out
}

func extractPowerRenameXMPPatterns(raw []byte) map[string]string {
	out := map[string]string{}
	decoder := xml.NewDecoder(bytes.NewReader(raw))
	var stack []string
	for {
		token, err := decoder.Token()
		if err != nil {
			break
		}
		switch t := token.(type) {
		case xml.StartElement:
			stack = append(stack, t.Name.Local)
			for _, attr := range t.Attr {
				switch attr.Name.Local {
				case "CreatorTool":
					out["CREATOR_TOOL"] = attr.Value
				case "CreateDate":
					addParsedPowerRenameDate(out, "CREATE_DATE", attr.Value)
				case "DocumentID":
					out["DOCUMENT_ID"] = attr.Value
				case "InstanceID":
					out["INSTANCE_ID"] = attr.Value
				case "OriginalDocumentID":
					out["ORIGINAL_DOCUMENT_ID"] = attr.Value
				case "VersionID":
					out["VERSION_ID"] = attr.Value
				}
			}
		case xml.CharData:
			text := strings.TrimSpace(string(t))
			if text == "" {
				continue
			}
			path := strings.Join(stack, "/")
			switch {
			case strings.Contains(path, "title/Alt/li"):
				out["TITLE"] = text
			case strings.Contains(path, "description/Alt/li"):
				out["DESCRIPTION"] = text
			case strings.Contains(path, "creator/Seq/li"):
				out["CREATOR"] = text
				out["AUTHOR"] = text
			case strings.Contains(path, "subject/Bag/li"):
				if out["SUBJECT"] == "" {
					out["SUBJECT"] = text
				} else {
					out["SUBJECT"] += "; " + text
				}
			case strings.Contains(path, "WebStatement"):
				out["RIGHTS"] = text
				out["COPYRIGHT"] = text
			}
		case xml.EndElement:
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}
	return out
}

func addParsedPowerRenameDate(out map[string]string, prefix string, value string) {
	if tm, err := time.Parse(time.RFC3339, value); err == nil {
		addPowerRenameDateParts(out, prefix, tm)
	}
}

func addPowerRenameDateParts(out map[string]string, prefix string, tm time.Time) {
	out[prefix+"_YYYY"] = tm.Format("2006")
	out[prefix+"_YY"] = tm.Format("06")
	out[prefix+"_MM"] = tm.Format("01")
	out[prefix+"_DD"] = tm.Format("02")
	out[prefix+"_HH"] = tm.Format("15")
	out[prefix+"_mm"] = tm.Format("04")
	out[prefix+"_SS"] = tm.Format("05")
}

func sanitizePowerRenameMetadataValue(value string) string {
	replacer := strings.NewReplacer("<", "", ">", "", ":", "", "\"", "", "/", "", "\\", "", "|", "", "?", "", "*", "")
	return replacer.Replace(value)
}
```

- [ ] **Step 5: Populate per-item context in HTTP plan building**

Modify `resolveRenameInputs` in `internal/rename/handlers.go` to include absolute path metadata by extending `InputItem` in `internal/rename/types.go`:

```go
type InputItem struct {
	RelativePath string
	IsDir        bool
	AbsPath      string
}
```

Then in `resolveRenameInputs`:

```go
inputs = append(inputs, InputItem{RelativePath: rel, IsDir: info.IsDir(), AbsPath: resolved.Abs})
```

Modify `PowerRenamePlan` before calling `powerRenameName`:

```go
itemOpts := opts
if item.AbsPath != "" {
	itemOpts.TemplateContext = buildPowerRenameTemplateContext(item.AbsPath)
}
newName, err := powerRenameName(oldName, itemOpts, i+1)
```

- [ ] **Step 6: Verify extraction tests pass**

Run:

```bash
go test ./internal/rename -run 'TestExtractPowerRenameXMPPatterns|TestBuildPowerRenameTemplateContextUsesFileTimes' -v
```

Expected: PASS.

- [ ] **Step 7: Commit metadata extraction**

Run:

```bash
git add go.mod go.sum internal/rename
git commit -m "feat: extract powerrename metadata"
```

## Task 8: PowerRename Dialog Rename And Options

**Files:**
- Rename or modify: `web/src/components/RenameDialog.tsx`
- Rename or modify: `web/src/components/RenameDialog.test.tsx`
- Modify: `web/src/api/types.ts`
- Modify: `web/src/i18n.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Add failing dialog tests for PowerRename naming and options**

Append to `web/src/components/RenameDialog.test.tsx`:

```tsx
it("renders as PowerRename with PowerRename options", async () => {
  vi.mocked(api.renamePreview).mockResolvedValue({ hasConflict: false, items: [] });
  render(<RenameDialog rootId="data" paths={["file.txt"]} onJobCreated={vi.fn()} onClose={vi.fn()} />);

  expect(screen.getByRole("heading", { name: "PowerRename" })).toBeInTheDocument();
  expect(screen.getByLabelText("Use regular expressions")).toBeInTheDocument();
  expect(screen.getByLabelText("Match all occurrences")).toBeInTheDocument();
  expect(screen.getByLabelText("Name only")).toBeInTheDocument();
  expect(screen.getByLabelText("Extension only")).toBeInTheDocument();
  expect(screen.getByLabelText("Full name")).toBeInTheDocument();
  expect(screen.getByLabelText("Uppercase")).toBeInTheDocument();
  expect(screen.getByLabelText("Randomize items")).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify dialog test fails**

Run:

```bash
npm --prefix web run test -- --run src/components/RenameDialog.test.tsx
```

Expected: FAIL because labels/options are not present.

- [ ] **Step 3: Expand frontend types**

Modify `web/src/api/types.ts` `RenameOptions` to include PowerRename fields:

```ts
nameOnly: boolean;
extensionOnly: boolean;
fullName: boolean;
excludeFiles: boolean;
excludeFolders: boolean;
excludeSubfolders: boolean;
uppercase: boolean;
lowercase: boolean;
titlecase: boolean;
capitalized: boolean;
enumerateItems: boolean;
randomizeItems: boolean;
```

- [ ] **Step 4: Update dialog defaults and labels**

Modify `web/src/components/RenameDialog.tsx` heading to `{labels.powerRename}` and replace old target/include controls with controls bound to the new fields:

```tsx
<label>
  <input type="checkbox" checked={options.useRegex} onChange={(event) => update({ useRegex: event.target.checked })} />
  {labels.useRegularExpressions}
</label>
<label>
  <input type="checkbox" checked={options.matchAll} onChange={(event) => update({ matchAll: event.target.checked })} />
  {labels.matchAllOccurrences}
</label>
<label>
  <input type="checkbox" checked={options.nameOnly} onChange={(event) => update({ nameOnly: event.target.checked, extensionOnly: false })} />
  {labels.nameOnly}
</label>
<label>
  <input type="checkbox" checked={options.extensionOnly} onChange={(event) => update({ extensionOnly: event.target.checked, nameOnly: false })} />
  {labels.extensionOnly}
</label>
<label>
  <input type="checkbox" checked={options.fullName} onChange={(event) => update({ fullName: event.target.checked, nameOnly: false, extensionOnly: false })} />
  {labels.fullName}
</label>
<label>
  <input type="checkbox" checked={options.uppercase} onChange={(event) => update({ uppercase: event.target.checked, lowercase: false, titlecase: false, capitalized: false })} />
  {labels.uppercase}
</label>
<label>
  <input type="checkbox" checked={options.randomizeItems} onChange={(event) => update({ randomizeItems: event.target.checked })} />
  {labels.randomizeItems}
</label>
```

- [ ] **Step 5: Add labels in `web/src/i18n.ts`**

Add `UIStrings` fields:

```ts
useRegularExpressions: string;
matchAllOccurrences: string;
nameOnly: string;
extensionOnly: string;
fullName: string;
uppercase: string;
lowercase: string;
titlecase: string;
capitalized: string;
randomizeItems: string;
```

English values:

```ts
useRegularExpressions: "Use regular expressions",
matchAllOccurrences: "Match all occurrences",
nameOnly: "Name only",
extensionOnly: "Extension only",
fullName: "Full name",
uppercase: "Uppercase",
lowercase: "Lowercase",
titlecase: "Titlecase",
capitalized: "Capitalized",
randomizeItems: "Randomize items",
```

Simplified Chinese values:

```ts
useRegularExpressions: "使用正则表达式",
matchAllOccurrences: "匹配所有出现项",
nameOnly: "仅文件名",
extensionOnly: "仅扩展名",
fullName: "全名称",
uppercase: "大写",
lowercase: "小写",
titlecase: "标题大小写",
capitalized: "首字母大写",
randomizeItems: "随机化项目",
```

- [ ] **Step 6: Verify dialog tests pass**

Run:

```bash
npm --prefix web run test -- --run src/components/RenameDialog.test.tsx src/components/DualPane.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit PowerRename dialog**

Run:

```bash
git add web/src/components/RenameDialog.tsx web/src/components/RenameDialog.test.tsx web/src/api/types.ts web/src/i18n.ts web/src/styles.css
git commit -m "feat: expose powerrename dialog options"
```

## Task 9: End-To-End Verification And Local Server

**Files:**
- Verify source tree, build output, and local server behavior.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm --prefix web run test -- --run
npm --prefix web run build
go test ./...
```

Expected: all commands exit `0`.

- [ ] **Step 2: Rebuild and restart local server**

Run:

```bash
npm --prefix web run build
pkill -f 'filebutler -config /tmp/filebutler-test/filebutler.yaml' || true
go run ./cmd/filebutler -config /tmp/filebutler-test/filebutler.yaml
```

Expected: server logs `FileButler listening on 0.0.0.0:8080`.

- [ ] **Step 3: Browser-check ordinary rename and PowerRename**

Use Playwright with system Chrome:

```bash
node - <<'NODE'
const { chromium } = require('./web/node_modules/playwright');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle' });
  if (await page.getByRole('heading', { name: 'Administrator login' }).isVisible().catch(() => false)) {
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('long-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.waitForLoadState('networkidle');
  }
  const left = page.getByRole('region', { name: /左栏|Left pane/ });
  await left.getByLabel(/选择 file2.txt|Select file2.txt/).check();
  const renameDisabled = await page.getByRole('button', { name: /重命名|Rename/ }).isDisabled();
  const powerRenameDisabled = await page.getByRole('button', { name: 'PowerRename' }).isDisabled();
  console.log(JSON.stringify({ renameDisabled, powerRenameDisabled }));
  await browser.close();
})();
NODE
```

Expected: `{"renameDisabled":false,"powerRenameDisabled":false}`.

- [ ] **Step 4: Commit any final test or documentation adjustments**

Run:

```bash
git status --short
```

Expected: clean working tree except intentionally untracked local files. If source files changed during verification, inspect and commit them with a specific message.
