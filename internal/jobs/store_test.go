package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCreateAndSnapshotActiveJob(t *testing.T) {
	store := newStore("runtime-a", 16, 16)
	job := Job{ID: "job_1", Type: "copy", ActorID: 1, SourceRootID: "a", DestRootID: "b", ProgressTotal: 2}
	if err := store.Create(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.RuntimeID != "runtime-a" || snapshot.Cursor != 1 || snapshot.Reset || len(snapshot.Jobs) != 1 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if snapshot.Jobs[0].ID != job.ID || snapshot.Jobs[0].Status != StatusPending || snapshot.Jobs[0].FailedCount != 0 {
		t.Fatalf("job=%+v", snapshot.Jobs[0])
	}
	encoded, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), `"item"`) || strings.Contains(string(encoded), `"items"`) {
		t.Fatalf("snapshot retained item payloads: %s", encoded)
	}
}

func TestRuntimeIDAndActiveJobLookup(t *testing.T) {
	store := newStore("runtime-a", 16, 16)
	if store.RuntimeID() != "runtime-a" {
		t.Fatalf("runtime ID = %q", store.RuntimeID())
	}
	active, err := store.IsActive(context.Background(), "job-1")
	if err != nil || active {
		t.Fatalf("missing active = %v, err = %v", active, err)
	}
	createTestJob(t, store, "job-1", 1)
	active, err = store.IsActive(context.Background(), "job-1")
	if err != nil || !active {
		t.Fatalf("created active = %v, err = %v", active, err)
	}
	if err := store.Finish(context.Background(), "job-1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	active, err = store.IsActive(context.Background(), "job-1")
	if err != nil || active {
		t.Fatalf("finished active = %v, err = %v", active, err)
	}

	var unavailable Store
	if unavailable.RuntimeID() != "" {
		t.Fatalf("unavailable runtime ID = %q", unavailable.RuntimeID())
	}
	if _, err := unavailable.IsActive(context.Background(), "job"); err == nil {
		t.Fatal("unavailable active lookup returned nil error")
	}
}

func TestProgressEventsAreCoalescedWhileSnapshotsStayCurrent(t *testing.T) {
	now := time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)
	store := newStore("runtime-a", 16, 16)
	store.state.now = func() time.Time { return now }
	createTestJob(t, store, "job_1", 4)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}

	now = now.Add(99 * time.Millisecond)
	for range 3 {
		if err := store.RecordProgress(context.Background(), "job_1", nil); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Cursor != 2 || snapshot.Jobs[0].ProgressDone != 3 || snapshot.Jobs[0].EventVersion != 2 {
		t.Fatalf("coalesced snapshot=%+v", snapshot)
	}

	now = now.Add(time.Millisecond)
	if err := store.RecordProgress(context.Background(), "job_1", nil); err != nil {
		t.Fatal(err)
	}
	snapshot, err = store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Cursor != 3 || snapshot.Jobs[0].ProgressDone != 4 || snapshot.Jobs[0].EventVersion != 3 {
		t.Fatalf("published snapshot=%+v", snapshot)
	}
	if got := replayEvents(store); len(got) != 3 || got[2].Job.ProgressDone != 4 {
		t.Fatalf("replay=%+v", got)
	}
}

func TestTerminalEventFlushesLatestSummaryAndRemovesActiveJob(t *testing.T) {
	now := time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)
	store := newStore("runtime-a", 16, 16)
	store.state.now = func() time.Time { return now }
	createTestJob(t, store, "job_1", 1)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	now = now.Add(20 * time.Millisecond)
	if err := store.RecordProgress(context.Background(), "job_1", nil); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}

	events := replayEvents(store)
	if len(events) != 3 {
		t.Fatalf("events=%+v", events)
	}
	terminal := events[2]
	if terminal.Job.Status != StatusCompleted || terminal.Job.ProgressDone != 1 || terminal.Cursor != 3 {
		t.Fatalf("terminal=%+v", terminal)
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 0 {
		t.Fatalf("terminal job remained active: %+v", snapshot.Jobs)
	}
	if _, err := store.Get(context.Background(), "job_1"); !errors.Is(err, ErrJobNotFound) {
		t.Fatalf("get terminal error=%v", err)
	}
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatalf("terminal cancel should be idempotent: %v", err)
	}
}

func TestProgressAggregatesFailuresAndKeepsOnlyFirstErrorSummary(t *testing.T) {
	now := time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)
	store := newStore("runtime-a", 16, 16)
	store.state.now = func() time.Time { return now }
	createTestJob(t, store, "job_1", 3)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	for _, itemErr := range []error{errors.New("permission denied"), nil, errors.New("disk full")} {
		if err := store.RecordProgress(context.Background(), "job_1", itemErr); err != nil {
			t.Fatal(err)
		}
	}
	job, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.ProgressDone != 3 || job.FailedCount != 2 || job.ErrorMessage != "" {
		t.Fatalf("active job=%+v", job)
	}
	if err := store.Finish(context.Background(), "job_1", StatusCompletedWithErrors, ""); err != nil {
		t.Fatal(err)
	}
	terminal := replayEvents(store)[2]
	if terminal.Job.FailedCount != 2 || terminal.Job.ErrorMessage != "permission denied" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

func TestRequestCancelIsIdempotentAndImmediate(t *testing.T) {
	store := NewStore()
	createTestJob(t, store, "job_1", 1)
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	job, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != StatusCancelRequested || !job.CancelRequested || job.EventVersion != 2 {
		t.Fatalf("job=%+v", job)
	}
	if err := store.RequestCancel(context.Background(), "missing"); err != nil {
		t.Fatal(err)
	}
}

func TestConcurrentProgressUpdatesRemainConsistent(t *testing.T) {
	const itemCount = 100
	store := newStore("runtime-a", 256, 256)
	fixedNow := time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)
	store.state.now = func() time.Time { return fixedNow }
	createTestJob(t, store, "job_1", itemCount)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errorsByItem := make(chan error, itemCount)
	for index := range itemCount {
		wait.Add(1)
		go func() {
			defer wait.Done()
			var itemErr error
			if index%10 == 0 {
				itemErr = fmt.Errorf("failure %d", index)
			}
			errorsByItem <- store.RecordProgress(context.Background(), "job_1", itemErr)
		}()
	}
	wait.Wait()
	close(errorsByItem)
	for err := range errorsByItem {
		if err != nil {
			t.Fatal(err)
		}
	}
	job, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.ProgressDone != itemCount || job.FailedCount != 10 || job.EventVersion != 2 {
		t.Fatalf("job=%+v", job)
	}
}

func createTestJob(t *testing.T, store Store, id string, total int) {
	t.Helper()
	if err := store.Create(context.Background(), Job{
		ID: id, Type: "copy", ActorID: 1, SourceRootID: "a", DestRootID: "b", ProgressTotal: total,
	}); err != nil {
		t.Fatal(err)
	}
}

func replayEvents(store Store) []Event {
	store.state.mu.Lock()
	defer store.state.mu.Unlock()
	return append([]Event(nil), store.state.replay...)
}
