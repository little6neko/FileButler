package superrename

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestPreviewHandlerReturnsSafeInventory(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "albums", "A", "photo.jpg"), "x")
	handler := PreviewHandler(Scanner{Resolver: roots.NewResolver([]roots.Root{{ID: "media", Path: root}})})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, superRenameRequest(PreviewRequest{RootID: "media", DirectoryPath: "albums"}, false))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data Inventory `json:"data"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Groups) != 1 || body.Data.Groups[0].Images[0].SourcePath != "albums/A/photo.jpg" {
		t.Fatalf("inventory = %+v", body.Data)
	}
	if strings.Contains(recorder.Body.String(), filepath.ToSlash(root)) {
		t.Fatal("preview exposed the mapped root absolute path")
	}
}

func TestCreateJobHandlerRejectsStaleAndConflictingSelectionsWithoutAJob(t *testing.T) {
	tests := []struct {
		name          string
		prepare       func(t *testing.T, root string)
		selectedPaths []string
		wantCode      string
	}{
		{
			name: "stale",
			prepare: func(t *testing.T, root string) {
				testutil.WriteFile(t, filepath.Join(root, "albums", "A", "a.jpg"), "a")
			},
			selectedPaths: []string{"albums/A/missing.jpg"},
			wantCode:      "stale_preview",
		},
		{
			name: "conflict",
			prepare: func(t *testing.T, root string) {
				testutil.WriteFile(t, filepath.Join(root, "albums", "A", "01.jpg"), "occupied")
				testutil.WriteFile(t, filepath.Join(root, "albums", "A", "a.jpg"), "a")
			},
			selectedPaths: []string{"albums/A/a.jpg"},
			wantCode:      "plan_conflict",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			test.prepare(t, root)
			resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
			store := jobs.NewStore()
			handler := CreateJobHandler(Scanner{Resolver: resolver}, Planner{}, store, Runner{})
			request := CreateJobRequest{RootID: "media", DirectoryPath: "albums", SelectedPaths: test.selectedPaths}
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, superRenameRequest(request, true))
			if recorder.Code != http.StatusConflict || responseErrorCode(t, recorder) != test.wantCode {
				t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			snapshot, err := store.Snapshot(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if len(snapshot.Jobs) != 0 {
				t.Fatalf("unexpected jobs = %+v", snapshot.Jobs)
			}
		})
	}
}

func TestCreateJobHandlerAcceptsOnlySourceSelections(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "albums", "A", "a.jpg"), "a")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	handler := CreateJobHandler(Scanner{Resolver: resolver}, Planner{}, jobs.NewStore(), Runner{})
	recorder := httptest.NewRecorder()
	payload := map[string]any{
		"rootId":        "media",
		"directoryPath": "albums",
		"selectedPaths": []string{"albums/A/a.jpg"},
		"targetPaths":   []string{"albums/A/owned-by-client.jpg"},
	}
	handler.ServeHTTP(recorder, superRenameRequest(payload, true))
	if recorder.Code != http.StatusBadRequest || responseErrorCode(t, recorder) != "invalid_request" {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestCreateJobHandlerRegistersSuperRenameJobAndRunsGroups(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "albums", "A", "a.jpg"), "a")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	store := jobs.NewStore()
	executor := newBlockingGroupExecutor()
	runner := Runner{Store: store, Executor: executor}
	handler := CreateJobHandler(Scanner{Resolver: resolver}, Planner{}, store, runner)
	recorder := httptest.NewRecorder()
	request := CreateJobRequest{RootID: "media", DirectoryPath: "albums", SelectedPaths: []string{"albums/A/a.jpg"}}
	handler.ServeHTTP(recorder, superRenameRequest(request, true))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	group := <-executor.started
	if group.Path != "albums/A" || len(group.Items) != 1 || group.Items[0].TargetPath != "albums/A/01.jpg" {
		t.Fatalf("group = %+v", group)
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || snapshot.Jobs[0].Type != "super_rename" || snapshot.Jobs[0].ProgressTotal != 1 || snapshot.Jobs[0].Status != jobs.StatusRunning {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	close(executor.release)
}

func TestCreateJobHandlerExecutesARealSuperRenameJob(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "albums", "A", "photo.jpg"), "photo")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	store := jobs.NewStore()
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	runner := Runner{Store: store, Executor: Executor{Resolver: resolver}}
	handler := CreateJobHandler(Scanner{Resolver: resolver}, Planner{}, store, runner)
	recorder := httptest.NewRecorder()
	request := CreateJobRequest{RootID: "media", DirectoryPath: "albums", SelectedPaths: []string{"albums/A/photo.jpg"}}
	handler.ServeHTTP(recorder, superRenameRequest(request, true))
	if recorder.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	terminal := waitForTerminalJob(t, subscription.Events)
	if terminal.Status != jobs.StatusCompleted || terminal.ProgressDone != 1 {
		t.Fatalf("terminal = %+v", terminal)
	}
	assertFileContent(t, filepath.Join(root, "albums", "A", "01.jpg"), "photo")
}

type blockingGroupExecutor struct {
	started chan PlanGroup
	release chan struct{}
}

func newBlockingGroupExecutor() *blockingGroupExecutor {
	return &blockingGroupExecutor{started: make(chan PlanGroup, 1), release: make(chan struct{})}
}

func (executor *blockingGroupExecutor) ExecuteGroup(_ context.Context, _ string, _ string, group PlanGroup) error {
	executor.started <- group
	<-executor.release
	return nil
}

func superRenameRequest(payload any, authenticated bool) *http.Request {
	body, _ := json.Marshal(payload)
	request := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	if authenticated {
		request = request.WithContext(auth.ContextWithUser(request.Context(), auth.User{ID: 1, Username: "admin"}))
	}
	return request
}

func responseErrorCode(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body.Error.Code
}
