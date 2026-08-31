package links

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
)

func TestPreviewHandlerReturnsAuthoritativeConflictPreview(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "source")
	mustWrite(t, filepath.Join(destRoot, "file.txt"), "occupied")
	planner := testPlanner(sourceRoot, destRoot)
	recorder := httptest.NewRecorder()

	PreviewHandler(planner).ServeHTTP(recorder, linkRequest(t, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	}))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data Preview `json:"data"`
	}
	decodeLinkBody(t, recorder, &body)
	if !body.Data.HasConflict || body.Data.Items[0].ErrorCode != ErrorTargetExists || body.Data.PreviewRevision == "" {
		t.Fatalf("preview = %+v", body.Data)
	}
	if strings.Contains(recorder.Body.String(), sourceRoot) || strings.Contains(recorder.Body.String(), destRoot) {
		t.Fatalf("response leaked an absolute path: %s", recorder.Body.String())
	}
}

func TestCreateJobHandlerReturnsUpdatedPreviewForStaleOrConflictingPlan(t *testing.T) {
	t.Run("stale revision takes precedence", func(t *testing.T) {
		sourceRoot := t.TempDir()
		destRoot := t.TempDir()
		file := filepath.Join(sourceRoot, "set", "file.txt")
		mustWrite(t, file, "source")
		planner := testPlanner(sourceRoot, destRoot)
		request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: "."}
		oldPlan := mustPlan(t, planner, request)
		if err := os.Link(file, filepath.Join(sourceRoot, "set", "old-object.txt")); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(file); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, file, "replacement")
		mustWrite(t, filepath.Join(destRoot, "file.txt"), "occupied")
		recorder := httptest.NewRecorder()
		jobRequest := JobRequest{
			Type: request.Type, SourceRoot: request.SourceRoot, Sources: request.Sources,
			DestRoot: request.DestRoot, DestPath: request.DestPath, PreviewRevision: oldPlan.Preview.PreviewRevision,
		}
		handler := CreateJobHandler(planner, jobs.NewStore(), Runner{})
		handler.ServeHTTP(recorder, authenticatedLinkRequest(t, jobRequest))
		if recorder.Code != http.StatusConflict {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
		var body linkErrorResponse
		decodeLinkBody(t, recorder, &body)
		if body.Error.Code != "stale_preview" || body.Data.PreviewRevision == oldPlan.Preview.PreviewRevision || !body.Data.HasConflict {
			t.Fatalf("body = %+v", body)
		}
	})

	t.Run("same conflicting revision", func(t *testing.T) {
		sourceRoot := t.TempDir()
		destRoot := t.TempDir()
		mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "source")
		mustWrite(t, filepath.Join(destRoot, "file.txt"), "occupied")
		planner := testPlanner(sourceRoot, destRoot)
		request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: "."}
		current := mustPlan(t, planner, request)
		recorder := httptest.NewRecorder()
		handler := CreateJobHandler(planner, jobs.NewStore(), Runner{})
		handler.ServeHTTP(recorder, authenticatedLinkRequest(t, JobRequest{
			Type: request.Type, SourceRoot: request.SourceRoot, Sources: request.Sources,
			DestRoot: request.DestRoot, DestPath: request.DestPath, PreviewRevision: current.Preview.PreviewRevision,
		}))
		if recorder.Code != http.StatusConflict {
			t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
		}
		var body linkErrorResponse
		decodeLinkBody(t, recorder, &body)
		if body.Error.Code != "plan_conflict" || body.Data.PreviewRevision != current.Preview.PreviewRevision {
			t.Fatalf("body = %+v", body)
		}
	})
}

func TestCreateJobHandlerRegistersAndRunsLinkJob(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "source")
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	})
	store := jobs.NewStore()
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	executor := Executor{Planner: planner, Staging: NewStagingManager(store.RuntimeID())}
	runner := Runner{Store: store, Executor: executor}
	recorder := httptest.NewRecorder()

	CreateJobHandler(planner, store, runner).ServeHTTP(recorder, authenticatedLinkRequest(t, JobRequest{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
		PreviewRevision: plan.Preview.PreviewRevision,
	}))

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	var body struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	decodeLinkBody(t, recorder, &body)
	if body.Data.ID == "" {
		t.Fatal("missing job ID")
	}
	terminal := waitLinkTerminal(t, subscription.Events)
	if terminal.ID != body.Data.ID || terminal.Status != jobs.StatusCompleted || terminal.ProgressDone != 1 {
		t.Fatalf("terminal = %+v", terminal)
	}
	if !mustIdentity(t, filepath.Join(sourceRoot, "set", "file.txt"), false).SameObject(mustIdentity(t, filepath.Join(destRoot, "file.txt"), false)) {
		t.Fatal("job did not create the hardlink")
	}
}

func TestLinkHandlersRejectMalformedUnauthorizedAndOversizedRequests(t *testing.T) {
	planner := testPlanner(t.TempDir(), t.TempDir())
	tests := []struct {
		name    string
		handler http.Handler
		request *http.Request
		status  int
	}{
		{
			name: "unknown field", handler: PreviewHandler(planner), status: http.StatusBadRequest,
			request: httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"type":"hardlink","unknown":true}`)),
		},
		{
			name: "oversized", handler: PreviewHandler(planner), status: http.StatusRequestEntityTooLarge,
			request: httptest.NewRequest(http.MethodPost, "/", strings.NewReader(strings.Repeat(" ", maxLinkRequestBodyBytes+1))),
		},
		{
			name: "unauthorized", handler: CreateJobHandler(planner, jobs.NewStore(), Runner{}), status: http.StatusUnauthorized,
			request: linkRequest(t, JobRequest{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"file"}, DestRoot: "dest", DestPath: ".", PreviewRevision: testRevision}),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			test.handler.ServeHTTP(recorder, test.request)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
			}
		})
	}
}

type linkErrorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
	Data Preview `json:"data"`
}

func linkRequest(t *testing.T, payload any) *http.Request {
	t.Helper()
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	return request
}

func authenticatedLinkRequest(t *testing.T, payload any) *http.Request {
	t.Helper()
	request := linkRequest(t, payload)
	return request.WithContext(auth.ContextWithUser(request.Context(), auth.User{ID: 1, Username: "admin"}))
}

func decodeLinkBody(t *testing.T, recorder *httptest.ResponseRecorder, destination any) {
	t.Helper()
	if err := json.NewDecoder(recorder.Body).Decode(destination); err != nil {
		t.Fatal(err)
	}
}
