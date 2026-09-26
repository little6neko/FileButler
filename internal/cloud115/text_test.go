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

type textLinkProvider struct {
	link  string
	calls int
}

func (p *textLinkProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	p.calls++
	if method != "preview.url" {
		panic("unexpected provider operation")
	}
	return json.RawMessage(p.link), nil
}

func TestTextPreviewValidatesAccountSizeTypeAndRequest(t *testing.T) {
	for _, tc := range []struct {
		name, body, link string
		authenticated    bool
		status           int
		calls            int
	}{
		{"requires login", `{"accountId":"7","id":"1"}`, `{}`, false, 401, 0},
		{"no arbitrary URLs", `{"accountId":"7","id":"1","url":"https://example.com"}`, `{}`, true, 400, 0},
		{"requires ID", `{"accountId":"7"}`, `{}`, true, 400, 0},
		{"wrong account", `{"accountId":"7","id":"1"}`, `{"accountId":"8","url":"https://example.com","name":"a.txt","size":2}`, true, 409, 1},
		{"size limit", `{"accountId":"7","id":"1"}`, `{"accountId":"7","url":"https://example.com","name":"a.txt","size":10485761}`, true, 413, 1},
		{"only text", `{"accountId":"7","id":"1"}`, `{"accountId":"7","url":"https://example.com","name":"a.mp4","size":2}`, true, 400, 1},
		{"unsafe URL", `{"accountId":"7","id":"1"}`, `{"accountId":"7","url":"file:///etc/passwd","name":"a.txt","size":2}`, true, 502, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p := &textLinkProvider{link: tc.link}
			s := NewService(p, jobs.NewStore(), roots.NewResolver(nil))
			router := chi.NewRouter()
			router.Post("/{method}", s.Handler)
			req := httptest.NewRequest("POST", "/preview.text", strings.NewReader(tc.body))
			if tc.authenticated {
				req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: 1}))
			}
			out := httptest.NewRecorder()
			router.ServeHTTP(out, req)
			if out.Code != tc.status || p.calls != tc.calls {
				t.Fatalf("status=%d calls=%d body=%s", out.Code, p.calls, out.Body.String())
			}
		})
	}
}
