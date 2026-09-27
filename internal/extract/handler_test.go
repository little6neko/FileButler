package extract

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
	"time"

	"github.com/little6neko/filebutler/internal/auth"
	"github.com/little6neko/filebutler/internal/jobs"
)

func TestJobSurvivesRequestCancellationAndOmitsPassword(t *testing.T) {
	s, req, dir := fixture(t, "test.zip")
	zipFixture(t, filepath.Join(dir, req.SourcePath), "a.txt")
	req.Password = "not-a-job-field"
	store := jobs.NewStore()
	sub, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Unsubscribe()
	body, _ := json.Marshal(req)
	ctx, cancel := context.WithCancel(auth.ContextWithUser(context.Background(), auth.User{ID: 1}))
	request := httptest.NewRequest(http.MethodPost, "/api/extract/jobs", bytes.NewReader(body)).WithContext(ctx)
	response := httptest.NewRecorder()
	Handler(s, store)(response, request)
	cancel()
	if response.Code != http.StatusCreated {
		t.Fatalf("%d %s", response.Code, response.Body.String())
	}
	var result struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	timeout := time.After(5 * time.Second)
	for {
		var job jobs.Job
		select {
		case event := <-sub.Events:
			job = event.Job
		case <-timeout:
			t.Fatal("job did not finish")
		}
		if job.ID != result.Data.ID {
			continue
		}
		encoded, _ := json.Marshal(job)
		if strings.Contains(string(encoded), req.Password) {
			t.Fatal("password stored in job")
		}
		if job.Status.IsTerminal() {
			if job.Status != jobs.StatusCompleted || job.ProgressDone != 1 {
				t.Fatalf("%+v", job)
			}
			return
		}
	}
}

func TestQueuedCancellationDoesNotCreateOutput(t *testing.T) {
	s, req, dir := fixture(t, "test.zip")
	zipFixture(t, filepath.Join(dir, req.SourcePath), "a.txt")
	store := jobs.NewStore()
	ctx := context.Background()
	sub, err := store.Subscribe(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer sub.Unsubscribe()
	if err := store.Create(ctx, jobs.Job{ID: "cancel", Type: "extract", ProgressTotal: 1}); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestCancel(ctx, "cancel"); err != nil {
		t.Fatal(err)
	}
	run(s, store, "cancel", req)
	timeout := time.After(5 * time.Second)
	for {
		select {
		case event := <-sub.Events:
			if !event.Job.Status.IsTerminal() {
				continue
			}
			if event.Job.Status != jobs.StatusCanceled {
				t.Fatalf("%+v", event.Job)
			}
			if _, err := os.Stat(filepath.Join(dir, "output")); !os.IsNotExist(err) {
				t.Fatalf("created output after queued cancellation: %v", err)
			}
			return
		case <-timeout:
			t.Fatal("cancellation did not finish")
		}
	}
}
