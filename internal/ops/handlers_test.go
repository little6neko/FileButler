package ops

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestOpsDryRunReturnsPlan(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "x")
	handler := DryRunHandler(Planner{Resolver: testResolver(rootA, rootB)})

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, jsonReq(Request{Type: OpCopy, SourceRoot: "a", Sources: []string{"a.txt"}, DestRoot: "b", DestPath: "."}))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data Plan `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Data.Items) != 1 || body.Data.HasConflict {
		t.Fatalf("plan=%+v", body.Data)
	}
}

func TestOpsCreateJobRegistersActiveJob(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "x")
	store := jobs.NewStore()
	executor := newBlockingItemExecutor()
	runner := jobs.Runner{Store: store, Executor: executor}
	handler := CreateJobHandler(Planner{Resolver: testResolver(rootA, rootB)}, store, runner)

	req := jsonReq(Request{Type: OpCopy, SourceRoot: "a", Sources: []string{"a.txt"}, DestRoot: "b", DestPath: "."})
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: 1, Username: "admin"}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	<-executor.started
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || snapshot.Jobs[0].Type != "copy" || snapshot.Jobs[0].Status != jobs.StatusRunning {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	close(executor.release)
}

func jsonReq(payload any) *http.Request {
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

type blockingItemExecutor struct {
	started chan struct{}
	release chan struct{}
}

func newBlockingItemExecutor() *blockingItemExecutor {
	return &blockingItemExecutor{started: make(chan struct{}), release: make(chan struct{})}
}

func (executor *blockingItemExecutor) ExecuteItem(context.Context, jobs.ExecutableItem) error {
	close(executor.started)
	<-executor.release
	return nil
}
