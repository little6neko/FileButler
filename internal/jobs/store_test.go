package jobs

import (
	"context"
	"testing"

	"github.com/little6neko/filebutler/internal/testutil"
)

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
	if err := store.AddItemResult(context.Background(), ItemResult{JobID: "job_1", Index: 0, SourcePath: "a.txt", DestPath: "b.txt", Status: "completed", UndoJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	_, items, err := store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].SourcePath != "a.txt" {
		t.Fatalf("items=%+v", items)
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
