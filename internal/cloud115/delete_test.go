package cloud115

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

func observeDeleteJobs(t *testing.T, store jobs.Store) func(string) jobs.Job {
	t.Helper()
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(subscription.Unsubscribe)
	finished := make(map[string]jobs.Job)
	return func(id string) jobs.Job {
		t.Helper()
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		for {
			if job, ok := finished[id]; ok {
				return job
			}
			select {
			case event, ok := <-subscription.Events:
				if !ok {
					t.Fatal("subscription closed")
					return jobs.Job{}
				}
				if event.Job.Status.IsTerminal() {
					finished[event.Job.ID] = event.Job
				}
			case <-timer.C:
				t.Fatalf("job %s did not finish", id)
				return jobs.Job{}
			}
		}
	}
}

func TestDeleteUsesOneProviderCallForEntireSelection(t *testing.T) {
	for _, fail := range []bool{false, true} {
		store := jobs.NewStore()
		terminal := observeDeleteJobs(t, store)
		_ = store.Create(context.Background(), jobs.Job{ID: "delete", ProgressTotal: 3})
		provider := &stubProvider{failure: fail}
		service := NewService(provider, store, roots.NewResolver(nil))
		service.run("delete", "delete", map[string]any{"accountId": "7"}, []map[string]any{{"id": "1"}, {"id": "9223372036854775808"}, {"id": "3"}})
		if provider.calls != 1 {
			t.Fatalf("got %d calls", provider.calls)
		}
		args := provider.lastArgs.(map[string]any)
		if args["accountId"] != "7" || !reflect.DeepEqual(args["ids"], []string{"1", "9223372036854775808", "3"}) {
			t.Fatalf("unexpected args: %#v", args)
		}
		job := terminal("delete")
		want := jobs.StatusCompleted
		if fail {
			want = jobs.StatusCompletedWithErrors
			if job.FailedCount != 3 {
				t.Fatalf("failed count: %d", job.FailedCount)
			}
		} else if job.Transfer == nil || !strings.Contains(job.Transfer.Warning, "云端可能仍在处理") {
			t.Fatal("accepted deletion must not claim remote completion")
		}
		if job.Status != want || job.ProgressDone != 3 {
			t.Fatalf("unexpected job: %+v", job)
		}
	}
}

type deleteCall struct {
	method string
	args   map[string]any
}

type deleteBlockingProvider struct {
	started chan deleteCall
	release chan struct{}
}

func (p *deleteBlockingProvider) Call(ctx context.Context, method string, args any, report jobs.Reporter) (json.RawMessage, error) {
	if method == "account" {
		return json.RawMessage(`{}`), nil
	}
	if method == "ops.plan" {
		params := args.(map[string]any)
		entries := params["sources"].([]map[string]any)
		items := make([]map[string]any, len(entries))
		for i := range entries {
			items[i] = map[string]any{"sourcePath": entries[i]["id"], "conflict": false}
		}
		return json.Marshal(map[string]any{"items": items, "entries": entries, "revision": "unchanged", "hasConflict": false})
	}
	p.started <- deleteCall{method, args.(map[string]any)}
	<-p.release
	return json.RawMessage(`{"submitted":true}`), nil
}

func TestDeleteSerializesOnlySameAccountAndQueuedJobsCanCancel(t *testing.T) {
	provider := &deleteBlockingProvider{started: make(chan deleteCall, 8), release: make(chan struct{})}
	var release sync.Once
	defer release.Do(func() { close(provider.release) })
	store := jobs.NewStore()
	terminal := observeDeleteJobs(t, store)
	service := NewService(provider, store, roots.NewResolver(nil))
	router := chi.NewRouter()
	router.Post("/{method}", service.Handler)
	submit := func(method, body string) string {
		t.Helper()
		response := httptest.NewRecorder()
		ctx := auth.ContextWithUser(context.Background(), auth.User{ID: 1})
		if method == "ops.create" {
			router.ServeHTTP(response, httptest.NewRequest("POST", "/ops.preview", strings.NewReader(body)).WithContext(ctx))
			if response.Code != 200 {
				t.Fatalf("preview %d: %s", response.Code, response.Body.String())
			}
			var preview struct {
				Data struct {
					PreviewToken string `json:"previewToken"`
				} `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &preview); err != nil {
				t.Fatal(err)
			}
			var request map[string]any
			if err := json.Unmarshal([]byte(body), &request); err != nil {
				t.Fatal(err)
			}
			confirmation, err := json.Marshal(map[string]any{"accountId": request["accountId"], "previewToken": preview.Data.PreviewToken})
			if err != nil {
				t.Fatal(err)
			}
			body = string(confirmation)
			response = httptest.NewRecorder()
		}
		router.ServeHTTP(response, httptest.NewRequest("POST", "/"+method, strings.NewReader(body)).WithContext(ctx))
		if response.Code != 201 {
			t.Fatalf("%d: %s", response.Code, response.Body.String())
		}
		var result struct {
			Data struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Data.ID
	}
	waitCall := func() deleteCall {
		t.Helper()
		select {
		case call := <-provider.started:
			return call
		case <-time.After(2 * time.Second):
			t.Fatal("provider did not start")
			return deleteCall{}
		}
	}
	first := submit("ops.create", `{"type":"delete","sourceRoot":"@115","sources":["1","9223372036854775808"],"accountId":"7","sourceAccountId":"7"}`)
	if call := waitCall(); call.method != "delete" || call.args["accountId"] != "7" || !reflect.DeepEqual(call.args["ids"], []string{"1", "9223372036854775808"}) {
		t.Fatal(call)
	}
	queued := submit("delete", `{"accountId":"7","ids":["3"]}`)
	other := submit("delete", `{"accountId":"8","ids":["4"]}`)
	if call := waitCall(); call.args["accountId"] != "8" {
		t.Fatal("same account deletion overlapped", call)
	}
	mkdir := submit("mkdir", `{"accountId":"7","name":"test"}`)
	if call := waitCall(); call.method != "mkdir" {
		t.Fatal("other operations blocked", call)
	}
	_ = store.RequestCancel(context.Background(), queued)
	waitStatus := func(id string, want jobs.Status) {
		t.Helper()
		if job := terminal(id); job.Status != want {
			t.Fatalf("job %s: got %s, want %s", id, job.Status, want)
		}
	}
	waitStatus(queued, jobs.StatusCanceled)
	next := submit("ops.create", `{"type":"delete","sourceRoot":"@115","sources":["5"],"accountId":"7","sourceAccountId":"7"}`)
	release.Do(func() { close(provider.release) })
	if call := waitCall(); call.method != "delete" || !reflect.DeepEqual(call.args["ids"], []string{"5"}) {
		t.Fatal(call)
	}
	for _, id := range []string{first, other, mkdir, next} {
		waitStatus(id, jobs.StatusCompleted)
	}
	select {
	case call := <-provider.started:
		t.Fatal("unexpected call", call)
	default:
	}
}

func TestDeleteCancellationDoesNotRecordBatchSuccess(t *testing.T) {
	store := jobs.NewStore()
	terminal := observeDeleteJobs(t, store)
	_ = store.Create(context.Background(), jobs.Job{ID: "delete", ProgressTotal: 2})
	provider := &stubProvider{cancel: true}
	service := NewService(provider, store, roots.NewResolver(nil))
	service.run("delete", "delete", nil, []map[string]any{{"id": "1"}, {"id": "2"}})
	job := terminal("delete")
	if job.Status != jobs.StatusCanceled || job.ProgressDone != 0 {
		t.Fatalf("%+v", job)
	}
}
