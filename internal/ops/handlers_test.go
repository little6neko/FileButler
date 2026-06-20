package ops

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/audit"
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

func TestOpsCreateJobPersistsPendingJob(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actor := insertUser(t, db)
	rootA := t.TempDir()
	rootB := t.TempDir()
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "x")
	store := jobs.Store{DB: db}
	runner := jobs.Runner{Store: store, Audit: audit.Store{DB: db}, Executor: JobExecutor{Executor: Executor{Resolver: testResolver(rootA, rootB)}}}
	handler := CreateJobHandler(Planner{Resolver: testResolver(rootA, rootB)}, store, runner)

	req := jsonReq(Request{Type: OpCopy, SourceRoot: "a", Sources: []string{"a.txt"}, DestRoot: "b", DestPath: "."})
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: actor, Username: "admin"}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var count int
	if err := db.QueryRowContext(context.Background(), `select count(1) from jobs`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("job count = %d", count)
	}
}

func jsonReq(payload any) *http.Request {
	body, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func insertUser(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	res, err := db.ExecContext(context.Background(), `insert into users(username, password_hash) values (?, ?)`, "admin-"+t.Name(), "hash")
	if err != nil {
		t.Fatal(err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	return id
}
