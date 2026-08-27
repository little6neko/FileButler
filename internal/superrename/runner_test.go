package superrename

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
)

func TestRunnerRecordsAGroupFailureForEveryItemAndContinues(t *testing.T) {
	store, subscription := superRenameRunnerStore(t)
	createSuperRenameJob(t, store, "job-groups", 3)
	executor := &recordingGroupExecutor{failGroup: "A"}
	runner := Runner{Store: store, Executor: executor}
	groups := []PlanGroup{
		{Path: "albums/A", Name: "A", Items: []PlanItem{{SourcePath: "a"}, {SourcePath: "b"}}},
		{Path: "albums/B", Name: "B", Items: []PlanItem{{SourcePath: "c"}}},
	}

	if err := runner.Run(context.Background(), "job-groups", "media", groups); err != nil {
		t.Fatal(err)
	}
	terminal := waitForTerminalJob(t, subscription.Events)
	if terminal.Status != jobs.StatusCompletedWithErrors || terminal.ProgressDone != 3 || terminal.FailedCount != 2 || terminal.ErrorMessage != "group failed" {
		t.Fatalf("terminal = %+v", terminal)
	}
	if len(executor.calls) != 2 || executor.calls[0] != "A" || executor.calls[1] != "B" {
		t.Fatalf("calls = %v", executor.calls)
	}
}

func TestRunnerAppliesCancellationOnlyBetweenGroups(t *testing.T) {
	store, subscription := superRenameRunnerStore(t)
	createSuperRenameJob(t, store, "job-cancel", 3)
	executor := &recordingGroupExecutor{}
	executor.afterGroup = func(group PlanGroup) {
		if group.Name == "A" {
			if err := store.RequestCancel(context.Background(), "job-cancel"); err != nil {
				t.Error(err)
			}
		}
	}
	runner := Runner{Store: store, Executor: executor}
	groups := []PlanGroup{
		{Path: "albums/A", Name: "A", Items: []PlanItem{{SourcePath: "a"}, {SourcePath: "b"}}},
		{Path: "albums/B", Name: "B", Items: []PlanItem{{SourcePath: "c"}}},
	}

	if err := runner.Run(context.Background(), "job-cancel", "media", groups); err != nil {
		t.Fatal(err)
	}
	terminal := waitForTerminalJob(t, subscription.Events)
	if terminal.Status != jobs.StatusCanceled || terminal.ProgressDone != 2 {
		t.Fatalf("terminal = %+v", terminal)
	}
	if len(executor.calls) != 1 || executor.calls[0] != "A" {
		t.Fatalf("calls = %v", executor.calls)
	}
}

func TestRunnerCompletesAllSuccessfulGroups(t *testing.T) {
	store, subscription := superRenameRunnerStore(t)
	createSuperRenameJob(t, store, "job-success", 2)
	runner := Runner{Store: store, Executor: &recordingGroupExecutor{}}
	groups := []PlanGroup{{Path: "albums/A", Name: "A", Items: []PlanItem{{SourcePath: "a"}, {SourcePath: "b"}}}}

	if err := runner.Run(context.Background(), "job-success", "media", groups); err != nil {
		t.Fatal(err)
	}
	terminal := waitForTerminalJob(t, subscription.Events)
	if terminal.Status != jobs.StatusCompleted || terminal.ProgressDone != 2 || terminal.FailedCount != 0 {
		t.Fatalf("terminal = %+v", terminal)
	}
}

type recordingGroupExecutor struct {
	calls      []string
	failGroup  string
	afterGroup func(PlanGroup)
}

func (executor *recordingGroupExecutor) ExecuteGroup(_ context.Context, _ string, _ string, group PlanGroup) error {
	executor.calls = append(executor.calls, group.Name)
	if executor.afterGroup != nil {
		executor.afterGroup(group)
	}
	if group.Name == executor.failGroup {
		return errors.New("group failed")
	}
	return nil
}

func superRenameRunnerStore(t *testing.T) (jobs.Store, jobs.Subscription) {
	t.Helper()
	store := jobs.NewStore()
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(subscription.Unsubscribe)
	return store, subscription
}

func createSuperRenameJob(t *testing.T, store jobs.Store, id string, total int) {
	t.Helper()
	if err := store.Create(context.Background(), jobs.Job{
		ID:            id,
		Type:          "super_rename",
		Status:        jobs.StatusPending,
		SourceRootID:  "media",
		ProgressTotal: total,
	}); err != nil {
		t.Fatal(err)
	}
}

func waitForTerminalJob(t *testing.T, events <-chan jobs.Event) jobs.Job {
	t.Helper()
	timeout := time.NewTimer(2 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case event := <-events:
			if event.Job.Status.IsTerminal() {
				return event.Job
			}
		case <-timeout.C:
			t.Fatal("timed out waiting for terminal job")
		}
	}
}
