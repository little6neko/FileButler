package jobs

import (
	"context"
	"errors"
	"testing"
)

func TestRunnerCompletesSuccessfulJob(t *testing.T) {
	store, subscription := runnerStore(t)
	createTestJob(t, store, "job_1", 1)
	runner := Runner{Store: store, Executor: fakeExecutor{failIndex: -1}}
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0, Action: "copy", SourcePath: "a.txt"}}); err != nil {
		t.Fatal(err)
	}
	terminal := readTerminalEvent(t, subscription.Events, 4)
	if terminal.Job.Status != StatusCompleted || terminal.Job.ProgressDone != 1 || len(terminal.Items) != 1 || terminal.Items[0].Status != "completed" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

func TestRunnerRecordsItemFailureAndContinues(t *testing.T) {
	store, subscription := runnerStore(t)
	createTestJob(t, store, "job_1", 2)
	runner := Runner{Store: store, Executor: fakeExecutor{failIndex: 0}}
	err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0, SourcePath: "bad"}, {Index: 1, SourcePath: "ok"}})
	if err != nil {
		t.Fatal(err)
	}
	terminal := readTerminalEvent(t, subscription.Events, 5)
	if terminal.Job.Status != StatusCompletedWithErrors || len(terminal.Items) != 2 || terminal.Items[0].Status != "failed" || terminal.Items[1].Status != "completed" {
		t.Fatalf("terminal=%+v", terminal)
	}
}

func TestRunnerStopsAfterCancelRequest(t *testing.T) {
	store, subscription := runnerStore(t)
	createTestJob(t, store, "job_1", 2)
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	runner := Runner{Store: store, Executor: fakeExecutor{failIndex: -1}}
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0}, {Index: 1}}); err != nil {
		t.Fatal(err)
	}
	terminal := readTerminalEvent(t, subscription.Events, 3)
	if terminal.Job.Status != StatusCanceled || len(terminal.Items) != 0 {
		t.Fatalf("terminal=%+v", terminal)
	}
}

func TestRunnerDoesNotExecuteRemovedTerminalJobAgain(t *testing.T) {
	store := NewStore()
	createTestJob(t, store, "job_1", 0)
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	executor := &countingExecutor{}
	runner := Runner{Store: store, Executor: executor}
	if err := runner.Run(context.Background(), "job_1", []ExecutableItem{{Index: 0}}); err != nil {
		t.Fatal(err)
	}
	if executor.calls != 0 {
		t.Fatalf("executor called %d times", executor.calls)
	}
}

type fakeExecutor struct {
	failIndex int
}

func (executor fakeExecutor) ExecuteItem(_ context.Context, item ExecutableItem) error {
	if executor.failIndex == item.Index {
		return errors.New("boom")
	}
	return nil
}

type countingExecutor struct {
	calls int
}

func (executor *countingExecutor) ExecuteItem(context.Context, ExecutableItem) error {
	executor.calls++
	return nil
}

func runnerStore(t *testing.T) (Store, Subscription) {
	t.Helper()
	store := newStore("runtime-a", 16, 16)
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(subscription.Unsubscribe)
	return store, subscription
}

func readTerminalEvent(t *testing.T, events <-chan Event, count int) Event {
	t.Helper()
	var terminal Event
	for index := 0; index < count; index++ {
		event := <-events
		if event.Job.Status.IsTerminal() {
			terminal = event
		}
	}
	return terminal
}
