package rename

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestRenamePreviewReturnsNaturalSortedPlan(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"file100.txt", "file02.txt", "file2.txt"} {
		testutil.WriteFile(t, filepath.Join(root, name), "x")
	}
	handler := PreviewHandler(browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, renameReq(Request{RootID: "data", Paths: []string{"file100.txt", "file02.txt", "file2.txt"}, Options: Options{Search: "file", Replace: "photo", Target: TargetName, IncludeFiles: true, Enumerate: true}}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data PlanResult `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Data.Items[0].NewName != "photo2 (1).txt" {
		t.Fatalf("plan=%+v", body.Data)
	}
}

func TestRenameCreateJobRejectsConflictingPlan(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "a.txt"), "x")
	testutil.WriteFile(t, filepath.Join(root, "b.txt"), "x")
	svc := browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}
	store := jobs.NewStore()
	handler := CreateJobHandler(svc, store, jobs.Runner{Store: store, Executor: Executor{Resolver: svc.Resolver}})
	req := renameReq(Request{RootID: "data", Paths: []string{"a.txt"}, Options: Options{Search: "a", Replace: "b", Target: TargetName, IncludeFiles: true}})
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: 1, Username: "admin"}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRenameExecutorRenamesUnmappedSymlinkEntry(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	target := filepath.Join(outside, "target.txt")
	testutil.WriteFile(t, target, "outside")
	if err := os.Symlink(target, filepath.Join(root, "before.txt")); err != nil {
		t.Fatal(err)
	}
	executor := Executor{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}

	err := executor.ExecuteItem(context.Background(), jobs.ExecutableItem{
		Action: "rename", SourceRoot: "data", SourcePath: "before.txt", DestRoot: "data", DestPath: "after.txt",
	})
	if err != nil {
		t.Fatalf("ExecuteItem: %v", err)
	}
	linkTarget, err := os.Readlink(filepath.Join(root, "after.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if linkTarget != target {
		t.Fatalf("link target = %q, want %q", linkTarget, target)
	}
	if body, err := os.ReadFile(target); err != nil || string(body) != "outside" {
		t.Fatalf("outside target = %q, err = %v", body, err)
	}
}

func TestRenamePreviewAcceptsPowerRenameOptionsFromJSON(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "photo.txt"), "x")
	handler := PreviewHandler(browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})})
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, renameReq(map[string]any{
		"rootId": "data",
		"paths":  []string{"photo.txt"},
		"options": map[string]any{
			"search":    "photo",
			"replace":   "pic",
			"nameOnly":  true,
			"uppercase": true,
		},
	}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data PlanResult `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Items) != 1 || body.Data.Items[0].NewName != "PIC.txt" {
		t.Fatalf("plan=%+v", body.Data)
	}
}

func TestSingleRenameCreateJobRejectsMultiplePaths(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "a.txt"), "x")
	testutil.WriteFile(t, filepath.Join(root, "b.txt"), "x")
	svc := browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}
	store := jobs.NewStore()
	handler := SingleRenameCreateJobHandler(svc, store, jobs.Runner{Store: store, Executor: Executor{Resolver: svc.Resolver}})
	req := renameReq(SingleRenameRequest{RootID: "data", Paths: []string{"a.txt", "b.txt"}, NewName: "next.txt"})
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: 1, Username: "admin"}))
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPowerRenameAndSingleRenameUseDistinctJobTypes(t *testing.T) {
	for _, test := range []struct {
		name     string
		wantType string
		build    func(browser.Service, jobs.Store, jobs.Runner) http.Handler
		payload  any
	}{
		{
			name:     "power rename",
			wantType: "power_rename",
			build: func(service browser.Service, store jobs.Store, runner jobs.Runner) http.Handler {
				return CreateJobHandler(service, store, runner)
			},
			payload: Request{RootID: "data", Paths: []string{"a.txt"}, Options: Options{Search: "a", Replace: "b", Target: TargetName, IncludeFiles: true}},
		},
		{
			name:     "ordinary rename",
			wantType: "rename",
			build: func(service browser.Service, store jobs.Store, runner jobs.Runner) http.Handler {
				return SingleRenameCreateJobHandler(service, store, runner)
			},
			payload: SingleRenameRequest{RootID: "data", Paths: []string{"a.txt"}, NewName: "b.txt"},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			testutil.WriteFile(t, filepath.Join(root, "a.txt"), "x")
			service := browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}
			store := jobs.NewStore()
			executor := newBlockingRenameExecutor()
			runner := jobs.Runner{Store: store, Executor: executor}
			req := renameReq(test.payload)
			req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: 1, Username: "admin"}))
			recorder := httptest.NewRecorder()
			test.build(service, store, runner).ServeHTTP(recorder, req)
			if recorder.Code != http.StatusCreated {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			<-executor.started
			snapshot, err := store.Snapshot(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if len(snapshot.Jobs) != 1 || snapshot.Jobs[0].Type != test.wantType {
				t.Fatalf("snapshot=%+v", snapshot)
			}
			close(executor.release)
		})
	}
}

type Request = HandlerRequest

func renameReq(payload any) *http.Request {
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

type blockingRenameExecutor struct {
	started chan struct{}
	release chan struct{}
}

func newBlockingRenameExecutor() *blockingRenameExecutor {
	return &blockingRenameExecutor{started: make(chan struct{}), release: make(chan struct{})}
}

func (executor *blockingRenameExecutor) ExecuteItem(context.Context, jobs.ExecutableItem) error {
	close(executor.started)
	<-executor.release
	return nil
}
