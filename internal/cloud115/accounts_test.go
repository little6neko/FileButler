package cloud115

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

type accountProbe struct {
	started chan string
	release chan struct{}
}

func (p *accountProbe) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	a := args.(map[string]any)["accountId"].(string)
	if method == "browse" {
		p.started <- a
		select {
		case <-p.release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return json.Marshal(map[string]any{"accountId": a})
}

func TestAccountRequestsDoNotBlockEachOther(t *testing.T) {
	p := &accountProbe{make(chan string, 2), make(chan struct{})}
	s := NewService(p, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	done := make(chan int, 2)
	defer func() { close(p.release); <-done; <-done }()
	for _, a := range []string{"1", "2"} {
		go func(account string) {
			out := httptest.NewRecorder()
			router.ServeHTTP(out, httptest.NewRequest("POST", "/browse", strings.NewReader(`{"accountId":"`+account+`","parentId":"0"}`)))
			done <- out.Code
		}(a)
	}
	for i := 0; i < 2; i++ {
		select {
		case <-p.started:
		case <-time.After(time.Second):
			t.Fatal("another account's request is globally blocked")
		}
	}
}

func TestLogoutOnlyBlocksForOwnActiveJobs(t *testing.T) {
	p := &accountProbe{}
	store := jobs.NewStore()
	_ = store.Create(context.Background(), jobs.Job{ID: "active", AccountID: "1", SourceRootID: "@115", ProgressTotal: 1})
	s := NewService(p, store, roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	for _, tc := range []struct {
		account string
		code    int
	}{{"1", 409}, {"2", 200}} {
		out := httptest.NewRecorder()
		router.ServeHTTP(out, httptest.NewRequest("POST", "/logout", strings.NewReader(`{"accountId":"`+tc.account+`"}`)))
		if out.Code != tc.code {
			t.Fatalf("account %s: %d", tc.account, out.Code)
		}
	}
}

func TestCrossAccountOperationRejectedBeforeProvider(t *testing.T) {
	p := &stubProvider{}
	s := NewService(p, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", s.Handler)
	for _, body := range []string{
		`{"type":"copy","sourceRoot":"@115","sources":["1"],"destRoot":"@115","destPath":"0","accountId":"1","sourceAccountId":"1","destAccountId":"2"}`,
		`{"type":"move","sourceRoot":"@115","sources":["1"],"destRoot":"@115","destPath":"0","accountId":"2","sourceAccountId":"1","destAccountId":"2"}`,
		`{"type":"copy","sourceRoot":"@115","sources":["1"],"destRoot":"@115","destPath":"0"}`,
	} {
		out := httptest.NewRecorder()
		router.ServeHTTP(out, httptest.NewRequest("POST", "/ops.preview", strings.NewReader(body)).WithContext(auth.ContextWithUser(context.Background(), auth.User{ID: 1})))
		if out.Code != 400 {
			t.Fatal(out.Code, out.Body.String())
		}
	}
	if p.calls != 0 {
		t.Fatal("cross account operation reached provider")
	}
}
