package jobs

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/little6neko/filebutler/internal/audit"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestRunnerCompletesSuccessfulJob(t *testing.T) {
	db, runner := runnerFixture(t, fakeExecutor{failIndex: -1})
	createRunnerJob(t, db, "job_1", 1)
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0, Action: "copy", SourceRoot: "a", SourcePath: "a.txt"}}); err != nil {
		t.Fatal(err)
	}
	job, items, err := runner.Store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != StatusCompleted || job.ProgressDone != 1 || len(items) != 1 || items[0].Status != "completed" {
		t.Fatalf("job=%+v items=%+v", job, items)
	}
}

func TestRunnerRecordsItemFailureAndContinues(t *testing.T) {
	db, runner := runnerFixture(t, fakeExecutor{failIndex: 0})
	createRunnerJob(t, db, "job_1", 2)
	err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0, Action: "copy", SourcePath: "bad"}, {Index: 1, Action: "copy", SourcePath: "ok"}})
	if err != nil {
		t.Fatal(err)
	}
	job, items, err := runner.Store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != StatusCompletedWithErrors || len(items) != 2 || items[0].Status != "failed" || items[1].Status != "completed" {
		t.Fatalf("job=%+v items=%+v", job, items)
	}
}

func TestRunnerStopsAfterCancelRequest(t *testing.T) {
	db, runner := runnerFixture(t, fakeExecutor{failIndex: -1})
	createRunnerJob(t, db, "job_1", 2)
	if err := runner.Store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0}, {Index: 1}}); err != nil {
		t.Fatal(err)
	}
	job, items, err := runner.Store.Get(context.Background(), "job_1")
	if err != nil {
		t.Fatal(err)
	}
	if job.Status != StatusCanceled || len(items) != 0 {
		t.Fatalf("job=%+v items=%+v", job, items)
	}
}

func TestRunnerWritesAuditRecordForCompletedItem(t *testing.T) {
	db, runner := runnerFixture(t, fakeExecutor{failIndex: -1})
	createRunnerJob(t, db, "job_1", 1)
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0, Action: "copy", SourceRoot: "a", SourcePath: "a.txt", DestRoot: "b", DestPath: "a.txt"}}); err != nil {
		t.Fatal(err)
	}
	records, err := runner.Audit.List(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 1 || records[0].Action != "copy" || records[0].JobID != "job_1" {
		t.Fatalf("records=%+v", records)
	}
}

func TestRunnerPublishesLifecycleEvents(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	broker := NewBroker(1)
	store := Store{DB: db, Publisher: broker}
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()
	if err := store.Create(context.Background(), Job{
		ID: "job_1", Type: "copy", ActorID: actorID, SourceRootID: "a",
		PlanJSON: "{}", RootSnapshotJSON: "{}", ProgressTotal: 1,
	}); err != nil {
		t.Fatal(err)
	}
	runner := Runner{Store: store, Audit: audit.Store{DB: db}, Executor: fakeExecutor{failIndex: -1}}
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0, Action: "copy", SourceRoot: "a", SourcePath: "a.txt"}}); err != nil {
		t.Fatal(err)
	}

	wantStatuses := []Status{StatusPending, StatusRunning, StatusRunning, StatusCompleted}
	for index, want := range wantStatuses {
		event, ok := <-events
		if !ok {
			t.Fatalf("event stream closed at index %d", index)
		}
		if event.Job.EventVersion != int64(index+1) || event.Job.Status != want {
			t.Fatalf("event %d = %+v, want version=%d status=%s", index, event, index+1, want)
		}
	}
}

func TestRunnerDoesNotExecuteTerminalJobAgain(t *testing.T) {
	db := testutil.OpenTestDB(t)
	actorID := insertActor(t, db)
	store := Store{DB: db}
	if err := store.Create(context.Background(), Job{ID: "job_1", Type: "copy", ActorID: actorID, SourceRootID: "a", PlanJSON: "{}", RootSnapshotJSON: "{}"}); err != nil {
		t.Fatal(err)
	}
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	executor := &countingExecutor{}
	runner := Runner{Store: store, Audit: audit.Store{DB: db}, Executor: executor}
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0}}); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 0 {
		t.Fatalf("executor called %d times for terminal job", executor.calls)
	}
}

type fakeExecutor struct {
	failIndex int
}

type countingExecutor struct {
	calls int
}

func (e *countingExecutor) ExecuteItem(context.Context, ExecutableItem) error {
	e.calls++
	return nil
}

func (f fakeExecutor) ExecuteItem(ctx context.Context, item ExecutableItem) error {
	if f.failIndex == item.Index {
		return errors.New("boom")
	}
	return nil
}

func runnerFixture(t *testing.T, executor ItemExecutor) (*sql.DB, Runner) {
	t.Helper()
	db := testutil.OpenTestDB(t)
	return db, Runner{Store: Store{DB: db}, Audit: audit.Store{DB: db}, Executor: executor}
}

func createRunnerJob(t *testing.T, db *sql.DB, id string, total int) {
	t.Helper()
	actorID := insertActor(t, db)
	store := Store{DB: db}
	if err := store.Create(context.Background(), Job{ID: id, Type: "copy", Status: StatusPending, ActorID: actorID, SourceRootID: "a", DestRootID: "b", PlanJSON: "{}", RootSnapshotJSON: "{}", ProgressTotal: total}); err != nil {
		t.Fatal(err)
	}
}
