package web

import (
	"bytes"
	"encoding/json"
	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/details"
	"github.com/little6neko/filebutler/internal/roots"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestDetailsSectionsAndInvalidTargets(t *testing.T) {
	dir := t.TempDir()
	if e := os.WriteFile(filepath.Join(dir, "sample.txt"), []byte("hello"), 0600); e != nil {
		t.Fatal(e)
	}
	router := chi.NewRouter()
	router.Post("/{section}", detailsHandler(details.Service{Roots: roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})}))
	for _, section := range []string{"basic", "stats", "hash", "media"} {
		r := httptest.NewRequest("POST", "/"+section, bytes.NewBufferString(`{"rootId":"a","paths":["sample.txt"]}`))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s: %d %s", section, w.Code, w.Body.String())
		}
		var body map[string]any
		if json.Unmarshal(w.Body.Bytes(), &body) != nil {
			t.Fatal("invalid JSON")
		}
	}
	for _, body := range []string{`{"rootId":"a","paths":["../outside"]}`, `{"rootId":"a","paths":[]}`, `{"rootId":"a","paths":["sample.txt"],"url":"http://internal"}`} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", "/basic", bytes.NewBufferString(body)))
		if w.Code != 400 {
			t.Fatalf("accepted %s", body)
		}
	}
}
