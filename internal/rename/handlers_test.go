package rename

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
	db := testutil.OpenTestDB(t)
	actor := insertUser(t, db)
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "a.txt"), "x")
	testutil.WriteFile(t, filepath.Join(root, "b.txt"), "x")
	svc := browser.Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}
	handler := CreateJobHandler(svc, jobs.Store{DB: db}, jobs.Runner{Store: jobs.Store{DB: db}, Audit: audit.Store{DB: db}, Executor: Executor{Resolver: svc.Resolver}})
	req := renameReq(Request{RootID: "data", Paths: []string{"a.txt"}, Options: Options{Search: "a", Replace: "b", Target: TargetName, IncludeFiles: true}})
	req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: actor, Username: "admin"}))
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

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

type Request = HandlerRequest

func renameReq(payload any) *http.Request {
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
