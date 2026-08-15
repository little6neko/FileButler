package jobs

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/testutil"
)

func TestEventsHandlerStreamsSnapshotAndLiveChanges(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	broker := NewBroker(1)
	store := Store{DB: db, Publisher: broker}
	if err := store.Create(context.Background(), Job{
		ID: "job_1", Type: "copy", ActorID: actorID, SourceRootID: "a",
		PlanJSON: "{}", RootSnapshotJSON: "{}", ProgressTotal: 1,
	}); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(EventsHandler(store, broker))
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
	retry := readSSEBlock(t, reader)
	if retry["retry"] != "2000" {
		t.Fatalf("retry block=%v", retry)
	}
	snapshotBlock := readSSEBlock(t, reader)
	if snapshotBlock["event"] != "jobs.snapshot" || snapshotBlock["id"] != "1" {
		t.Fatalf("snapshot block=%v", snapshotBlock)
	}
	var snapshot Snapshot
	if err := json.Unmarshal([]byte(snapshotBlock["data"]), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Cursor != 1 || len(snapshot.Jobs) != 1 || snapshot.Jobs[0].Status != StatusPending {
		t.Fatalf("snapshot=%+v", snapshot)
	}

	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	changedBlock := readSSEBlock(t, reader)
	if changedBlock["event"] != "job.changed" || changedBlock["id"] != "2" {
		t.Fatalf("changed block=%v", changedBlock)
	}
	var changed Event
	if err := json.Unmarshal([]byte(changedBlock["data"]), &changed); err != nil {
		t.Fatal(err)
	}
	if changed.Job.Status != StatusRunning || changed.Job.EventVersion != 2 {
		t.Fatalf("changed=%+v", changed)
	}
}

func TestParseLastEventID(t *testing.T) {
	for _, value := range []string{"", "-1", "1.5", "abc", "+2", " 2"} {
		if got := parseLastEventID(value); got != nil {
			t.Fatalf("parseLastEventID(%q)=%d, want nil", value, *got)
		}
	}
	for value, want := range map[string]int64{"0": 0, "42": 42} {
		got := parseLastEventID(value)
		if got == nil || *got != want {
			t.Fatalf("parseLastEventID(%q)=%v, want %d", value, got, want)
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

var _ http.Handler = EventsHandler(Store{}, nil)
