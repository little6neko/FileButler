package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestEventsHandlerStreamsActiveSnapshotAndLiveChanges(t *testing.T) {
	store := newStore("runtime-a", 8, 8)
	createTestJob(t, store, "job_1", 1)
	server := httptest.NewServer(EventsHandler(store))
	defer server.Close()
	response, err := server.Client().Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if got := response.Header.Get("Content-Type"); got != "text/event-stream; charset=utf-8" {
		t.Fatalf("Content-Type=%q", got)
	}
	if got := response.Header.Get("Cache-Control"); got != "no-cache, no-transform" {
		t.Fatalf("Cache-Control=%q", got)
	}
	if got := response.Header.Get("X-Accel-Buffering"); got != "no" {
		t.Fatalf("X-Accel-Buffering=%q", got)
	}

	reader := bufio.NewReader(response.Body)
	if retry := readSSEBlock(t, reader); retry["retry"] != "2000" {
		t.Fatalf("retry=%v", retry)
	}
	snapshotBlock := readSSEBlock(t, reader)
	if snapshotBlock["event"] != "jobs.snapshot" || snapshotBlock["id"] != "runtime-a:1" {
		t.Fatalf("snapshot block=%v", snapshotBlock)
	}
	var snapshot Snapshot
	if err := json.Unmarshal([]byte(snapshotBlock["data"]), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.RuntimeID != "runtime-a" || snapshot.Cursor != 1 || snapshot.Reset || len(snapshot.Jobs) != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if strings.Contains(snapshotBlock["data"], `"item"`) || strings.Contains(snapshotBlock["data"], `"items"`) {
		t.Fatalf("snapshot retained item payloads: %s", snapshotBlock["data"])
	}

	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	changedBlock := readSSEBlock(t, reader)
	if changedBlock["event"] != "job.changed" || changedBlock["id"] != "runtime-a:2" {
		t.Fatalf("changed block=%v", changedBlock)
	}
	var changed Event
	if err := json.Unmarshal([]byte(changedBlock["data"]), &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Job.Status != StatusRunning || changed.Cursor != 2 {
		t.Fatalf("changed=%+v", changed)
	}
}

func TestEventsHandlerReplaysAValidCursorWithoutTerminalSnapshot(t *testing.T) {
	store := newStore("runtime-a", 8, 8)
	createTestJob(t, store, "job_1", 0)
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(EventsHandler(store))
	defer server.Close()
	request, err := http.NewRequest(http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Last-Event-ID", "runtime-a:1")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	_ = readSSEBlock(t, reader)
	replay := readSSEBlock(t, reader)
	if replay["event"] != "job.changed" || replay["id"] != "runtime-a:2" {
		t.Fatalf("replay=%v", replay)
	}
	var event Event
	if err := json.Unmarshal([]byte(replay["data"]), &event); err != nil {
		t.Fatal(err)
	}
	if event.Job.Status != StatusCompleted {
		t.Fatalf("event=%+v", event)
	}
	if strings.Contains(replay["data"], `"item"`) || strings.Contains(replay["data"], `"items"`) {
		t.Fatalf("event retained item payloads: %s", replay["data"])
	}
}

func TestEventsHandlerSendsResetSnapshotForAnotherRuntime(t *testing.T) {
	store := newStore("runtime-b", 8, 8)
	server := httptest.NewServer(EventsHandler(store))
	defer server.Close()
	request, err := http.NewRequest(http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Last-Event-ID", "runtime-a:8")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	reader := bufio.NewReader(response.Body)
	_ = readSSEBlock(t, reader)
	block := readSSEBlock(t, reader)
	var snapshot Snapshot
	if err := json.Unmarshal([]byte(block["data"]), &snapshot); err != nil {
		t.Fatal(err)
	}
	if !snapshot.Reset || snapshot.RuntimeID != "runtime-b" || block["id"] != "runtime-b:0" {
		t.Fatalf("block=%v snapshot=%+v", block, snapshot)
	}
}

func TestCancelHandlerIsIdempotentForUnknownJob(t *testing.T) {
	store := NewStore()
	router := chi.NewRouter()
	router.Post("/api/jobs/{id}/cancel", CancelHandler(store))
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/jobs/missing/cancel", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestParseLastEventID(t *testing.T) {
	for _, value := range []string{"", "runtime", ":1", "runtime:", "runtime:-1", "runtime:1.5", "runtime:+2", "runtime: 2"} {
		if got := parseLastEventID(value); got != nil {
			t.Fatalf("parseLastEventID(%q)=%+v, want nil", value, got)
		}
	}
	for value, want := range map[string]EventCursor{
		"runtime-a:0":  {RuntimeID: "runtime-a", Cursor: 0},
		"runtime-a:42": {RuntimeID: "runtime-a", Cursor: 42},
	} {
		got := parseLastEventID(value)
		if got == nil || *got != want {
			t.Fatalf("parseLastEventID(%q)=%+v, want %+v", value, got, want)
		}
	}
}

func readSSEBlock(t *testing.T, reader *bufio.Reader) map[string]string {
	t.Helper()
	block := make(map[string]string)
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read SSE block: %v", err)
		}
		line = strings.TrimSuffix(line, "\n")
		line = strings.TrimSuffix(line, "\r")
		if line == "" {
			return block
		}
		name, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		block[name] = strings.TrimPrefix(value, " ")
	}
}

var _ http.Handler = EventsHandler(Store{})
