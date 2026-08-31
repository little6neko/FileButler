package links

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
)

func TestRunnerCompletesSuccessfulGroupsAndRecordsEachStep(t *testing.T) {
	store, subscription := linkRunnerStore(t)
	groups := []PlanGroup{
		{SourcePath: "a", Steps: []PlanStep{{Action: ActionHardlink, RelativePath: "."}}},
		{SourcePath: "b", Steps: []PlanStep{{Action: ActionDirectory, RelativePath: "."}, {Action: ActionHardlink, RelativePath: "file"}}},
	}
	createLinkJob(t, store, "job-success", 3)
	executor := groupExecutorFunc(func(_ context.Context, _ string, group PlanGroup, hooks ExecutionHooks) error {
		for _, step := range group.Steps {
			if err := hooks.BeforeStep(step); err != nil {
				return err
			}
			if err := hooks.Report(step, nil); err != nil {
				return err
			}
		}
		return nil
	})
	runner := Runner{Store: store, Executor: executor}

	if err := runner.Run(context.Background(), "job-success", groups); err != nil {
		t.Fatal(err)
	}
	terminal := waitLinkTerminal(t, subscription.Events)
	if terminal.Status != jobs.StatusCompleted || terminal.ProgressDone != 3 || terminal.FailedCount != 0 {
		t.Fatalf("terminal = %+v", terminal)
	}
}

func TestRunnerFillsFailedGroupProgressAndContinuesLaterGroups(t *testing.T) {
	store, subscription := linkRunnerStore(t)
	groups := []PlanGroup{
		{SourcePath: "failed", Steps: []PlanStep{
			{Action: ActionDirectory, RelativePath: "."},
			{Action: ActionHardlink, RelativePath: "one"},
			{Action: ActionHardlink, RelativePath: "two"},
		}},
		{SourcePath: "success", Steps: []PlanStep{{Action: ActionHardlink, RelativePath: "."}}},
	}
	createLinkJob(t, store, "job-errors", 4)
	var calls []string
	executor := groupExecutorFunc(func(_ context.Context, _ string, group PlanGroup, hooks ExecutionHooks) error {
		calls = append(calls, group.SourcePath)
		if group.SourcePath == "failed" {
			if err := hooks.Report(group.Steps[0], nil); err != nil {
				return err
			}
			stepErr := errors.New("injected group failure")
			if err := hooks.Report(group.Steps[1], stepErr); err != nil {
				return err
			}
			return stepErr
		}
		return hooks.Report(group.Steps[0], nil)
	})
	runner := Runner{Store: store, Executor: executor}

	if err := runner.Run(context.Background(), "job-errors", groups); err != nil {
		t.Fatal(err)
	}
	terminal := waitLinkTerminal(t, subscription.Events)
	if terminal.Status != jobs.StatusCompletedWithErrors || terminal.ProgressDone != 4 || terminal.FailedCount != 2 {
		t.Fatalf("terminal = %+v", terminal)
	}
	if len(calls) != 2 || calls[0] != "failed" || calls[1] != "success" {
		t.Fatalf("calls = %v", calls)
	}
}

func TestRunnerCancellationKeepsPartialProgress(t *testing.T) {
	store, subscription := linkRunnerStore(t)
	group := PlanGroup{SourcePath: "group", Steps: []PlanStep{
		{Action: ActionHardlink, RelativePath: "one"},
		{Action: ActionHardlink, RelativePath: "two"},
		{Action: ActionHardlink, RelativePath: "three"},
	}}
	createLinkJob(t, store, "job-cancel", 3)
	executor := groupExecutorFunc(func(_ context.Context, _ string, group PlanGroup, hooks ExecutionHooks) error {
		if err := hooks.BeforeStep(group.Steps[0]); err != nil {
			return err
		}
		if err := hooks.Report(group.Steps[0], nil); err != nil {
			return err
		}
		if err := store.RequestCancel(context.Background(), "job-cancel"); err != nil {
			return err
		}
		return hooks.BeforeStep(group.Steps[1])
	})
	runner := Runner{Store: store, Executor: executor}

	if err := runner.Run(context.Background(), "job-cancel", []PlanGroup{group}); err != nil {
		t.Fatal(err)
	}
	terminal := waitLinkTerminal(t, subscription.Events)
	if terminal.Status != jobs.StatusCanceled || terminal.ProgressDone != 1 || terminal.FailedCount != 0 {
		t.Fatalf("terminal = %+v", terminal)
	}
}

type groupExecutorFunc func(context.Context, string, PlanGroup, ExecutionHooks) error

func (function groupExecutorFunc) ExecuteGroup(ctx context.Context, jobID string, group PlanGroup, hooks ExecutionHooks) error {
	return function(ctx, jobID, group, hooks)
}

func linkRunnerStore(t *testing.T) (jobs.Store, jobs.Subscription) {
	t.Helper()
	store := jobs.NewStore()
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(subscription.Unsubscribe)
	return store, subscription
}

func createLinkJob(t *testing.T, store jobs.Store, id string, total int) {
	t.Helper()
	if err := store.Create(context.Background(), jobs.Job{
		ID: id, Type: string(LinkHardlink), Status: jobs.StatusPending, SourceRootID: "source", DestRootID: "dest", ProgressTotal: total,
	}); err != nil {
		t.Fatal(err)
	}
}

func waitLinkTerminal(t *testing.T, events <-chan jobs.Event) jobs.Job {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			if event.Job.Status.IsTerminal() {
				return event.Job
			}
		case <-timer.C:
			t.Fatal("timed out waiting for terminal link job")
		}
	}
}
