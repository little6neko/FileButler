package cloud115

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
)

func TestOfflineHTTPPreservesWorkerBusinessRejection(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 unavailable")
	}
	script, _ := filepath.Abs("testdata/worker.py")
	db, err := storage.Open(filepath.Join(t.TempDir(), "filebutler.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	bridge := NewBridge(python, script, db, roots.NewResolver(nil))
	defer bridge.Close()
	service := NewService(bridge, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", service.Handler)
	for _, tc := range []struct {
		path   string
		status int
	}{{"rejected", 422}, {"unclassified", 502}} {
		t.Run(tc.path, func(t *testing.T) {
			ctx := auth.ContextWithUser(context.Background(), auth.User{ID: 1})
			request := httptest.NewRequest("POST", "/offline.add", strings.NewReader(`{"accountId":"7","destId":"0","url":"https://example.com/`+tc.path+`"}`)).WithContext(ctx)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != tc.status {
				t.Fatalf("%d: %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Content-Type") != "application/json" {
				t.Fatal(response.Header())
			}
			var result struct {
				Error struct{ Code, Message string }
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Error.Code != "cloud115_error" || result.Error.Message != "POST https://clouddownload.115.com/web/\n115 API unknown: 任务已存在，请勿输入重复的链接地址" {
				t.Fatal(result)
			}
		})
	}
}
