package cloud115

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

type operationProvider struct {
	mu       sync.Mutex
	revision string
	started  chan context.Context
	release  chan struct{}
}

func (p *operationProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	if method == "ops.execute" {
		p.started <- ctx
		<-p.release
		return json.RawMessage(`{"ok":true}`), nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return json.Marshal(map[string]any{"items": []any{map[string]any{"sourcePath": "a.txt", "destPath": "a.txt", "conflict": false}}, "hasConflict": false, "revision": p.revision, "entries": []any{map[string]any{"accountId": "7", "id": "1"}}})
}

func TestSharedPreviewTokensBindActorAndRevisionAndCreateDetachedTask(t *testing.T) {
	p := &operationProvider{revision: "before", started: make(chan context.Context, 1), release: make(chan struct{})}
	defer close(p.release)
	store := jobs.NewStore()
	s := NewService(p, store, roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	post := func(method, body string, actor int64) *httptest.ResponseRecorder {
		ctx := context.Background()
		if actor != 0 {
			ctx = auth.ContextWithUser(ctx, auth.User{ID: actor})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, httptest.NewRequest("POST", "/"+method, strings.NewReader(body)).WithContext(ctx))
		return out
	}
	body := `{"type":"move","sourceRoot":"@115","sources":["1"],"destRoot":"@115","destPath":"9","accountId":"7","sourceAccountId":"7","destAccountId":"7"}`
	if out := post("ops.preview", body, 0); out.Code != 401 {
		t.Fatal(out.Code)
	}
	out := post("ops.preview", body, 1)
	if out.Code != 200 {
		t.Fatal(out.Code, out.Body.String())
	}
	var envelope struct {
		Data struct {
			PreviewToken string `json:"previewToken"`
		} `json:"data"`
	}
	json.Unmarshal(out.Body.Bytes(), &envelope)
	confirm := `{"accountId":"7","previewToken":"` + envelope.Data.PreviewToken + `"}`
	if snapshot, _ := store.Snapshot(context.Background()); len(snapshot.Jobs) != 0 {
		t.Fatal("preview mutated files")
	}
	if out = post("ops.create", confirm, 2); out.Code != 409 {
		t.Fatal("other actor accepted", out.Code)
	}
	p.revision = "changed"
	if out = post("ops.create", confirm, 1); out.Code != 409 {
		t.Fatal("changed preview accepted", out.Code)
	}
	p.revision = "before"
	ctx, cancel := context.WithCancel(auth.ContextWithUser(context.Background(), auth.User{ID: 1}))
	defer cancel()
	out = httptest.NewRecorder()
	router.ServeHTTP(out, httptest.NewRequest("POST", "/ops.create", strings.NewReader(confirm)).WithContext(ctx))
	cancel()
	if out.Code != 201 {
		t.Fatal(out.Code, out.Body.String())
	}
	select {
	case taskCtx := <-p.started:
		if taskCtx.Err() != nil {
			t.Fatal("task tied to browser")
		}
	case <-time.After(time.Second):
		t.Fatal("task not started")
	}
	if out = post("ops.create", confirm, 1); out.Code != 409 {
		t.Fatal("token reused", out.Code)
	}
}

func TestSharedOperationRejectsUntrustedRootsAndCloudIDs(t *testing.T) {
	s := NewService(nil, jobs.NewStore(), roots.NewResolver(nil))
	for _, req := range []operationRequest{
		{Type: "copy", SourceRoot: "@115", Sources: []string{"0"}, DestRoot: "@115", DestPath: "1", AccountID: "7"},
		{Type: "copy", SourceRoot: "@115", Sources: []string{"../1"}, DestRoot: "@115", DestPath: "1", AccountID: "7"},
		{Type: "move", SourceRoot: "unknown", Sources: []string{"../../secret"}, DestRoot: "@115", DestPath: "0", AccountID: "7"},
		{Type: "copy", SourceRoot: "@115", Sources: []string{"1"}, DestRoot: "unknown", DestPath: "/etc", AccountID: "7"},
	} {
		if _, err := s.operationParams(req); err == nil {
			t.Fatal("accepted unsafe request", req)
		}
	}
}
