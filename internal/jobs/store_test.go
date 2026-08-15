package jobs

import (
	"context"
	"fmt"
	"testing"

	"github.com/little6neko/filebutler/internal/testutil"
)

type recordingPublisher struct {
	events []Event
}

func (p *recordingPublisher) Publish(event Event) {
	p.events = append(p.events, event)
}

func TestCreateAndLoadJob(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	store := Store{DB: db}
	job := Job{ID: "job_1", Type: "copy", Status: StatusPending, ActorID: actorID, SourceRootID: "a", DestRootID: "b", PlanJSON: "{}", RootSnapshotJSON: "{}", ProgressTotal: 2}
	if err := store.Create(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	got, items, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != job.ID || got.Type != job.Type || len(items) != 0 {
		t.Fatalf("got=%+v items=%+v", got, items)
	}
}

func TestAppendJobItemResults(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	store := Store{DB: db}
	if err := store.Create(context.Background(), Job{ID: "job_1", Type: "copy", Status: StatusPending, ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordItemResult(context.Background(), ItemResult{JobID: "job_1", Index: 0, SourcePath: "a.txt", DestPath: "b.txt", Status: "completed", UndoJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	job, items, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].SourcePath != "a.txt" {
		t.Fatalf("items=%+v", items)
	}
	if job.ProgressDone != 1 {
		t.Fatalf("progressDone=%d, want 1", job.ProgressDone)
	}
}

func TestRequestCancelMarksJob(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	store := Store{DB: db}
	if err := store.Create(context.Background(), Job{ID: "job_1", Type: "copy", Status: StatusPending, ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	cancel, err := store.IsCancelRequested(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if !cancel {
		t.Fatal("expected cancel request")
	}
}

func TestListJobsReturnsNewestFirst(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	store := Store{DB: db}
	for _, id := range []string{"job_1", "job_2"} {
		if err := store.Create(context.Background(), Job{ID: id, Type: "copy", Status: StatusPending, ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}"}); err != nil {
			t.Fatal(err)
		}
	}
	jobs, err := store.List(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 2 || jobs[0].ID != "job_2" {
		t.Fatalf("jobs=%+v", jobs)
	}
}

func TestEmptySnapshotReturnsAnEmptyJobArray(t *testing.T) {
	db := testutil.OpenTestDB(t)
	store := Store{DB: db}
	snapshot, err := store.Snapshot(context.Background(), nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Jobs == nil || len(snapshot.Jobs) != 0 {
		t.Fatalf("jobs=%v, want a non-nil empty slice", snapshot.Jobs)
	}
}

func TestJobMutationsAllocateMonotonicEventVersions(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	publisher := &recordingPublisher{}
	store := Store{DB: db, Publisher: publisher}
	ctx := context.Background()

	if err := store.Create(ctx, Job{ID: "job_1", Type: "copy", ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}", ProgressTotal: 1}); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkRunning(ctx, "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordItemResult(ctx, ItemResult{JobID: "job_1", Index: 0, SourcePath: "a.txt", Status: "completed"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(ctx, "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}

	if len(publisher.events) != 4 {
		t.Fatalf("published %d events, want 4", len(publisher.events))
	}
	wantStatuses := []Status{StatusPending, StatusRunning, StatusRunning, StatusCompleted}
	for i, event := range publisher.events {
		if event.Job.EventVersion != int64(i+1) {
			t.Fatalf("event %d version = %d, want %d", i, event.Job.EventVersion, i+1)
		}
		if event.Job.Status != wantStatuses[i] {
			t.Fatalf("event %d status = %s, want %s", i, event.Job.Status, wantStatuses[i])
		}
	}
	if publisher.events[2].Item == nil || publisher.events[2].Job.ProgressDone != 1 {
		t.Fatalf("progress event = %+v", publisher.events[2])
	}
}

func TestRecordItemResultRollsBackProgressAndVersionOnFailure(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	publisher := &recordingPublisher{}
	store := Store{DB: db, Publisher: publisher}
	ctx := context.Background()
	if err := store.Create(ctx, Job{ID: "job_1", Type: "copy", ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}", ProgressTotal: 2}); err != nil {
		t.Fatal(err)
	}
	item := ItemResult{JobID: "job_1", Index: 0, SourcePath: "a.txt", Status: "completed"}
	if err := store.RecordItemResult(ctx, item); err != nil {
		t.Fatal(err)
	}
	if err := store.RecordItemResult(ctx, item); err == nil {
		t.Fatal("duplicate item unexpectedly succeeded")
	}

	job, items, err := store.Get(ctx, "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.ProgressDone != 1 || job.EventVersion != 2 || len(items) != 1 {
		t.Fatalf("job=%+v items=%+v", job, items)
	}
	clock, err := store.CurrentEventVersion(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if clock != 2 || len(publisher.events) != 2 {
		t.Fatalf("clock=%d events=%d, want 2 and 2", clock, len(publisher.events))
	}
}

func TestTerminalJobIgnoresLateMutations(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	publisher := &recordingPublisher{}
	store := Store{DB: db, Publisher: publisher}
	ctx := context.Background()
	if err := store.Create(ctx, Job{ID: "job_1", Type: "copy", ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(ctx, "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestCancel(ctx, "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.MarkRunning(ctx, "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(ctx, "job_1", StatusCanceled, "late cancel"); err != nil {
		t.Fatal(err)
	}

	job, _, err := store.Get(ctx, "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != StatusCompleted || job.EventVersion != 2 || job.CancelRequested {
		t.Fatalf("job changed after terminal state: %+v", job)
	}
	if len(publisher.events) != 2 {
		t.Fatalf("published %d events, want 2", len(publisher.events))
	}
}

func TestSnapshotIncludesCursorChangesBeyondTerminalLimit(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	store := Store{DB: db}
	ctx := context.Background()
	for i := 0; i < 55; i++ {
		id := fmt.Sprintf("job_%02d", i)
		if err := store.Create(ctx, Job{ID: id, Type: "copy", ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}"}); err != nil {
			t.Fatal(err)
		}
		if err := store.Finish(ctx, id, StatusCompleted, ""); err != nil {
			t.Fatal(err)
		}
	}

	baseline, err := store.Snapshot(ctx, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(baseline.Jobs) != 50 {
		t.Fatalf("baseline jobs=%d, want 50", len(baseline.Jobs))
	}
	cursor := int64(0)
	catchup, err := store.Snapshot(ctx, &cursor, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(catchup.Jobs) != 55 {
		t.Fatalf("catchup jobs=%d, want 55", len(catchup.Jobs))
	}
	if catchup.Cursor != 110 {
		t.Fatalf("cursor=%d, want 110", catchup.Cursor)
	}
}
