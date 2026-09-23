package cloud115

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

type capturePreviewProvider struct {
	calls  int
	params map[string]any
}

func (p *capturePreviewProvider) Call(_ context.Context, _ string, args any, _ jobs.Reporter) (json.RawMessage, error) {
	p.calls++
	p.params = args.(map[string]any)
	return json.RawMessage(`{"url":"https://cdn.example/file","accountId":"7"}`), nil
}

func TestPreviewRequiresAuthAndOnlyReturnsAnUncachedLink(t *testing.T) {
	p := &capturePreviewProvider{}
	s := NewService(p, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	req := httptest.NewRequest("POST", "/preview.url", strings.NewReader(`{"id":"1"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != 401 || p.calls != 0 {
		t.Fatal("unauthorized preview accessed provider")
	}
	req = httptest.NewRequest("POST", "/preview.url", strings.NewReader(`{"id":"1"}`)).WithContext(auth.ContextWithUser(context.Background(), auth.User{ID: 1}))
	req.Header.Set("User-Agent", "Browser-UA")
	response = httptest.NewRecorder()
	router.ServeHTTP(response, req)
	if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || p.params["userAgent"] != "Browser-UA" {
		t.Fatalf("%d %v %+v", response.Code, response.Header(), p.params)
	}
	if p.calls != 1 {
		t.Fatal("unexpected content request")
	}
}

func TestLoginCheckRequiresOpaqueSession(t *testing.T) {
	p := &capturePreviewProvider{}
	s := NewService(p, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("POST", "/login.check", strings.NewReader(`{}`)))
	if response.Code != 400 || p.calls != 0 {
		t.Fatal("sessionless login check allowed")
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("POST", "/login.check", strings.NewReader(`{"loginSession":"opaque-session-123456"}`)))
	if response.Code != 200 || p.params["loginSession"] != "opaque-session-123456" {
		t.Fatalf("%d %+v", response.Code, p.params)
	}
}
