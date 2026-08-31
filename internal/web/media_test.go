package web

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestMediaHandlerFollowsMappedSymlink(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	media := filepath.Join(base, "media")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	testutil.WriteFile(t, filepath.Join(media, "image.jpg"), "image-body")
	if err := os.Symlink(filepath.Join(media, "image.jpg"), filepath.Join(root, "linked.jpg")); err != nil {
		t.Fatal(err)
	}
	resolver := roots.NewResolver([]roots.Root{
		{ID: "root", Name: "Root", Path: root},
		{ID: "media", Name: "Media", Path: media},
	})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/media?rootId=root&path=linked.jpg", nil)

	mediaHandler(resolver).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK || recorder.Body.String() != "image-body" {
		t.Fatalf("status = %d, body = %q", recorder.Code, recorder.Body.String())
	}
}

func TestMediaHandlerRejectsUnmappedSymlink(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	testutil.WriteFile(t, filepath.Join(outside, "secret.jpg"), "secret")
	if err := os.Symlink(filepath.Join(outside, "secret.jpg"), filepath.Join(root, "linked.jpg")); err != nil {
		t.Fatal(err)
	}
	resolver := roots.NewResolver([]roots.Root{{ID: "root", Name: "Root", Path: root}})
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/media?rootId=root&path=linked.jpg", nil)

	mediaHandler(resolver).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %q", recorder.Code, recorder.Body.String())
	}
}
