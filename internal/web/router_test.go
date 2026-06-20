package web

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/audit"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/browser"
	"github.com/little6neko/filebutler/internal/config"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestHealthEndpoint(t *testing.T) {
	router := testRouter(t)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestInitStatusEndpoint(t *testing.T) {
	router := testRouter(t)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/init/status", nil))
	var body struct {
		Data struct {
			NeedsInitialization bool `json:"needsInitialization"`
		} `json:"data"`
	}
	decodeBody(t, rec, &body)
	if !body.Data.NeedsInitialization {
		t.Fatal("expected init required")
	}
}

func TestProtectedRoutesRequireLogin(t *testing.T) {
	router := testRouter(t)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/roots", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d", rec.Code)
	}
}

func TestCreateAdminThenLoginThenMe(t *testing.T) {
	router := testRouter(t)
	postJSON(t, router, "/api/init/admin", map[string]string{"username": "admin", "password": "long-password"}, nil)
	loginRec := postJSON(t, router, "/api/auth/login", map[string]string{"username": "admin", "password": "long-password"}, nil)
	if len(loginRec.Result().Cookies()) == 0 {
		t.Fatal("expected session cookie")
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	for _, cookie := range loginRec.Result().Cookies() {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRootsEndpointReturnsConfiguredRoots(t *testing.T) {
	router := testRouter(t)
	cookies := loginCookies(t, router)
	req := httptest.NewRequest(http.MethodGet, "/api/roots", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var body struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Path string `json:"path"`
		} `json:"data"`
	}
	decodeBody(t, rec, &body)
	if len(body.Data) != 1 || body.Data[0].ID != "data" || body.Data[0].Path != "" {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestBrowseEndpointReturnsEntries(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "file2.txt"), "x")
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)
	req := httptest.NewRequest(http.MethodGet, "/api/browse?rootId=data&path=.", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var body struct {
		Data []browser.Entry `json:"data"`
	}
	decodeBody(t, rec, &body)
	if len(body.Data) != 1 || body.Data[0].Name != "file2.txt" {
		t.Fatalf("body=%s", rec.Body.String())
	}
}

func TestMediaEndpointRequiresLogin(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "photo.jpg"), "image-bytes")
	router := testRouterWithRoot(t, root)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/media?rootId=data&path=photo.jpg", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMediaEndpointStreamsAuthenticatedMedia(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "photo.jpg"), "image-bytes")
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)
	req := httptest.NewRequest(http.MethodGet, "/api/media?rootId=data&path=photo.jpg", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.String(); got != "image-bytes" {
		t.Fatalf("body=%q", got)
	}
	if contentType := rec.Header().Get("Content-Type"); contentType != "image/jpeg" {
		t.Fatalf("content-type=%q", contentType)
	}
}

func TestMediaEndpointRejectsNonMediaFiles(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "notes.txt"), "plain text")
	router := testRouterWithRoot(t, root)
	cookies := loginCookies(t, router)
	req := httptest.NewRequest(http.MethodGet, "/api/media?rootId=data&path=notes.txt", nil)
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func testRouter(t *testing.T) http.Handler {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".keep"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	return testRouterWithRoot(t, root)
}

func testRouterWithRoot(t *testing.T, root string) http.Handler {
	t.Helper()
	db := testutil.OpenTestDB(t)
	resolver := roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})
	cfg := config.Config{Session: config.SessionConfig{CookieName: "filebutler_session"}, Roots: []config.RootConfig{{ID: "data", Name: "Data", Path: root}}}
	authSvc := auth.Service{DB: db, SessionMaxAge: time.Hour}
	return NewRouter(Deps{
		Config:     cfg,
		Auth:       authSvc,
		Roots:      resolver,
		Browser:    browser.Service{Resolver: resolver},
		OpsPlanner: ops.Planner{Resolver: resolver},
		JobStore:   jobs.Store{DB: db},
		AuditStore: audit.Store{DB: db},
	})
}

func loginCookies(t *testing.T, router http.Handler) []*http.Cookie {
	t.Helper()
	postJSON(t, router, "/api/init/admin", map[string]string{"username": "admin", "password": "long-password"}, nil)
	rec := postJSON(t, router, "/api/auth/login", map[string]string{"username": "admin", "password": "long-password"}, nil)
	return rec.Result().Cookies()
}

func postJSON(t *testing.T, router http.Handler, path string, payload any, cookies []*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code < 200 || rec.Code >= 300 {
		t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
	}
	return rec
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, dst any) {
	t.Helper()
	if rec.Code < 200 || rec.Code >= 300 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.NewDecoder(rec.Body).Decode(dst); err != nil {
		t.Fatal(err)
	}
}

var _ = context.Background
