package jobs

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
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
	if snapshot.Jobs[0].ID != job.ID || snapshot.Jobs[0].Status != StatusPending || snapshot.Jobs[0].Items == nil {
		t.Fatalf("detail=%+v", snapshot.Jobs[0])
	}
}

func TestSnapshotContainsAllAccumulatedItemResults(t *testing.T) {
	store := NewStore()
	createTestJob(t, store, "job_1", 2)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	for index, path := range []string{"a.txt", "b.txt"} {
		if err := store.RecordItemResult(context.Background(), ItemResult{JobID: "job_1", Index: index, SourcePath: path, Status: "completed"}); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 1 || snapshot.Jobs[0].ProgressDone != 2 || len(snapshot.Jobs[0].Items) != 2 {
		t.Fatalf("snapshot=%+v", snapshot)
	}
	if snapshot.Jobs[0].Items[0].SourcePath != "a.txt" || snapshot.Jobs[0].Items[1].SourcePath != "b.txt" {
		t.Fatalf("items=%+v", snapshot.Jobs[0].Items)
	}
}

func TestTerminalEventHasCompleteDetailAndRemovesActiveJob(t *testing.T) {
	store := newStore("runtime-a", 16, 16)
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	createTestJob(t, store, "job_1", 1)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordItemResult(context.Background(), ItemResult{JobID: "job_1", Index: 0, SourcePath: "a.txt", DestPath: "b.txt", Status: "completed"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}

	var terminal Event
	for index := 0; index < 4; index++ {
		event := <-subscription.Events
		if event.Job.Status.IsTerminal() {
			terminal = event
		}
	}
	if terminal.Job.Status != StatusCompleted || len(terminal.Items) != 1 || terminal.Items[0].SourcePath != "a.txt" {
		t.Fatalf("terminal=%+v", terminal)
	}
	snapshot, err := store.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Jobs) != 0 {
		t.Fatalf("terminal job remained active: %+v", snapshot.Jobs)
	}
	if _, _, err := store.Get(context.Background(), "job_1"); !errors.Is(err, ErrJobNotFound) {
		t.Fatalf("get terminal error=%v", err)
	}
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatalf("terminal cancel should be idempotent: %v", err)
	}
}

func TestRequestCancelIsIdempotent(t *testing.T) {
	store := NewStore()
	createTestJob(t, store, "job_1", 1)
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	job, _, err := store.Get(context.Background(), "job_1")
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

func TestDuplicateItemDoesNotAdvanceProgressOrCursor(t *testing.T) {
	store := NewStore()
	createTestJob(t, store, "job_1", 2)
	item := ItemResult{JobID: "job_1", Index: 0, SourcePath: "a.txt", Status: "completed"}
	if err := store.RecordItemResult(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordItemResult(context.Background(), item); !errors.Is(err, ErrDuplicateItem) {
		t.Fatalf("duplicate error=%v", err)
	}
	job, items, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.ProgressDone != 1 || job.EventVersion != 2 || len(items) != 1 {
		t.Fatalf("job=%+v items=%+v", job, items)
	}
}

func TestConcurrentItemUpdatesRemainConsistent(t *testing.T) {
	const itemCount = 100
	store := newStore("runtime-a", 256, 256)
	createTestJob(t, store, "job_1", itemCount)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	errorsByItem := make(chan error, itemCount)
	for index := 0; index < itemCount; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			errorsByItem <- store.RecordItemResult(context.Background(), ItemResult{
				JobID:      "job_1",
				Index:      index,
				SourcePath: fmt.Sprintf("%03d.txt", index),
				Status:     "completed",
			})
		}()
	}
	wait.Wait()
	close(errorsByItem)
	for err := range errorsByItem {
		if err != nil {
			t.Fatal(err)
		}
	}
	job, items, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.ProgressDone != itemCount || len(items) != itemCount || job.EventVersion != itemCount+2 {
		t.Fatalf("progress=%d items=%d version=%d", job.ProgressDone, len(items), job.EventVersion)
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
