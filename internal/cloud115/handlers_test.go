package cloud115

import (
	"context"
	"encoding/json"
	"errors"
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

type blockingProvider struct {
	started chan context.Context
	release chan struct{}
}

func TestCloudJobsStartConcurrently(t *testing.T) {
	provider := &blockingProvider{started: make(chan context.Context, 6), release: make(chan struct{})}
	store := jobs.NewStore()
	service := NewService(provider, store, roots.NewResolver(nil))
	var running sync.WaitGroup
	defer func() { close(provider.release); running.Wait() }()
	for _, id := range []string{"a", "b", "c", "d", "e", "f"} {
		if err := store.Create(context.Background(), jobs.Job{ID: id, ProgressTotal: 1}); err != nil {
			t.Fatal(err)
		}
		running.Add(1)
		go func() { defer running.Done(); service.run(id, "ops.execute", nil, []map[string]any{{}}) }()
	}
	for i := 0; i < 6; i++ {
		select {
		case <-provider.started:
		case <-time.After(2 * time.Second):
			t.Fatal("a task is waiting for another task to finish")
		}
	}
}

func (p *blockingProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	if method == "account" {
		return json.RawMessage(`{"accountId":"7"}`), nil
	}
	p.started <- ctx
	<-p.release
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return json.RawMessage(`{"ok":true}`), nil
}

func TestCloudTaskSurvivesRequestCancellation(t *testing.T) {
	provider := &blockingProvider{started: make(chan context.Context, 1), release: make(chan struct{})}
	store := jobs.NewStore()
	service := NewService(provider, store, roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", service.Handler)
	ctx, cancel := context.WithCancel(auth.ContextWithUser(context.Background(), auth.User{ID: 1}))
	defer cancel()
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest("POST", "/mkdir", strings.NewReader(`{"accountId":"7","name":"test"}`)).WithContext(ctx))
	if response.Code != 201 {
		t.Fatalf("%d %s", response.Code, response.Body.String())
	}
	defer close(provider.release)
	select {
	case taskContext := <-provider.started:
		cancel()
		if taskContext.Err() != nil {
			t.Fatal("browser request cancellation reached background task")
		}
	case <-time.After(time.Second):
		t.Fatal("task did not start")
	}
}

type stubProvider struct {
	cancel  bool
	failure bool
	calls   int
}

func (p *stubProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	p.calls++
	if p.cancel {
		return nil, context.Canceled
	}
	if p.failure {
		return nil, errors.New("provider failure")
	}
	if report != nil {
		if err := report(jobs.TransferProgress{Phase: "upload", BytesTotal: 10, BytesDone: 10, Cancelable: true}); err != nil {
			return nil, err
		}
	}
	return json.RawMessage(`{"ok":true}`), nil
}

func TestCloudJobTerminalStates(t *testing.T) {
	for _, tc := range []struct {
		name              string
		canceled, failure bool
		want              jobs.Status
	}{{"success", false, false, jobs.StatusCompleted}, {"cancel", true, false, jobs.StatusCanceled}, {"failure", false, true, jobs.StatusCompletedWithErrors}} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			store := jobs.NewStore()
			_ = store.Create(ctx, jobs.Job{ID: "cloud", ProgressTotal: 1})
			subscription, err := store.Subscribe(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			defer subscription.Unsubscribe()
			provider := &stubProvider{cancel: tc.canceled, failure: tc.failure}
			service := NewService(provider, store, roots.NewResolver(nil))
			service.run("cloud", "upload", map[string]any{}, []map[string]any{{}})
			for {
				select {
				case event := <-subscription.Events:
					if event.Job.Status.IsTerminal() {
						if event.Job.Status != tc.want {
							t.Fatalf("got %s want %s", event.Job.Status, tc.want)
						}
						return
					}
				case <-time.After(time.Second):
					t.Fatal("terminal event missing")
				}
			}
		})
	}
}

func TestRejectUnmappedUploadAndUnknownProviderMethods(t *testing.T) {
	provider := &stubProvider{}
	service := NewService(provider, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", service.Handler)
	for _, tc := range []struct {
		method, body string
		status       int
	}{
		{"upload", `{"rootId":"unknown","paths":["../../etc/passwd"]}`, 400},
		{"download", `{"ids":["1"],"rootId":"unknown","path":"/etc"}`, 400},
		{"request", `{"name":""}`, 404},
		{"browse", `{"parentId":"../1"}`, 400},
		{"browse", `{"localPath":"/etc"}`, 400},
		{"offline.add", `{"url":"file:///etc/passwd"}`, 400},
		{"offline.add", `{"url":""}`, 400},
		{"offline.add", `{"url":"https://"}`, 400},
		{"offline.add", `{"url":"https://example.com/a\nhttps://example.com/b"}`, 400},
		{"offline.add", `{"url":"magnet:?xt=urn:btih:test","destId":"../1"}`, 400},
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/"+tc.method, strings.NewReader(`{"accountId":"7",`+strings.TrimPrefix(tc.body, "{"))))
		if response.Code != tc.status {
			t.Errorf("%s: %d", tc.method, response.Code)
		}
	}
	if provider.calls != 0 {
		t.Fatal("invalid input reached provider")
	}
}

func TestOfflineSubmission(t *testing.T) {
	for _, link := range []string{"magnet:?xt=urn:btih:test", "ed2k://|file|test|1|hash|/", "https://example.com/file", "ftp://example.com/file"} {
		provider := &stubProvider{}
		service := NewService(provider, jobs.NewStore(), roots.NewResolver(nil))
		router := chi.NewRouter()
		router.Post("/{method}", service.Handler)
		body, _ := json.Marshal(map[string]string{"accountId": "7", "url": link, "destId": "123"})
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/offline.add", strings.NewReader(string(body))))
		if response.Code != 200 || provider.calls != 1 {
			t.Fatalf("%s: %d %s", link, response.Code, response.Body.String())
		}
	}
}

type quotaProvider struct {
	t     *testing.T
	calls []string
}

func (p *quotaProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	if method != "offline.quota" || report != nil {
		p.t.Fatalf("quota must be a query, got %s, progress=%v", method, report != nil)
	}
	if _, ok := ctx.Deadline(); !ok {
		p.t.Fatal("quota request has no deadline")
	}
	account := args.(map[string]any)["accountId"].(string)
	p.calls = append(p.calls, account)
	return json.RawMessage(`{"used":128,"total":2000,"remaining":1872}`), nil
}

func TestOfflineQuotaIsReadOnlyAndAccountScoped(t *testing.T) {
	provider := &quotaProvider{t: t}
	store := jobs.NewStore()
	service := NewService(provider, store, roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", service.Handler)
	for _, account := range []string{"7", "8"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/offline.quota", strings.NewReader(`{"accountId":"`+account+`"}`)))
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"remaining":1872`) {
			t.Fatalf("%d %s", response.Code, response.Body.String())
		}
	}
	for _, body := range []string{`{}`, `{"accountId":"0"}`, `{"accountId":"invalid"}`} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/offline.quota", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("missing/invalid account accepted: %d", response.Code)
		}
	}
	if len(provider.calls) != 2 || provider.calls[0] != "7" || provider.calls[1] != "8" {
		t.Fatalf("wrong account calls: %v", provider.calls)
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil || len(snapshot.Jobs) != 0 {
		t.Fatalf("quota query created a job: %+v %v", snapshot, err)
	}
}

type slowQuotaProvider struct{ started chan struct{} }

func (p *slowQuotaProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	if method == "offline.quota" {
		close(p.started)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	return json.RawMessage(`{"submitted":true}`), nil
}

func TestSlowOfflineQuotaDoesNotBlockSubmissionAndCanBeCanceled(t *testing.T) {
	provider := &slowQuotaProvider{started: make(chan struct{})}
	service := NewService(provider, jobs.NewStore(), roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", service.Handler)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	quotaDone := make(chan struct{})
	go func() {
		defer close(quotaDone)
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/offline.quota", strings.NewReader(`{"accountId":"7"}`)).WithContext(ctx))
	}()
	select {
	case <-provider.started:
	case <-time.After(time.Second):
		t.Fatal("quota query did not start")
	}
	submitted := make(chan int, 1)
	go func() {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("POST", "/offline.add", strings.NewReader(`{"accountId":"7","url":"https://example.com/file"}`)))
		submitted <- response.Code
	}()
	select {
	case status := <-submitted:
		if status != 200 {
			t.Fatalf("submission status=%d", status)
		}
	case <-time.After(time.Second):
		t.Fatal("submission blocked behind quota query")
	}
	cancel()
	select {
	case <-quotaDone:
	case <-time.After(time.Second):
		t.Fatal("quota request ignored cancellation")
	}
}
