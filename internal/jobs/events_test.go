package jobs

import (
	"context"
	"testing"
	"time"
)

func TestFastBulkProgressDoesNotOverflowSubscriberOrReplay(t *testing.T) {
	now := time.Date(2026, 8, 23, 10, 0, 0, 0, time.UTC)
	store := newStore("runtime-a", 8, 4)
	store.state.now = func() time.Time { return now }
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()

	createTestJob(t, store, "job_1", 300)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	for range 300 {
		if err := store.RecordProgress(context.Background(), "job_1", nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}

	for index, want := range []Status{StatusPending, StatusRunning, StatusCompleted} {
		event, open := <-subscription.Events
		if !open || event.Job.Status != want {
			t.Fatalf("event %d=%+v open=%v", index, event, open)
		}
		if want == StatusCompleted && event.Job.ProgressDone != 300 {
			t.Fatalf("terminal=%+v", event)
		}
	}
	select {
	case event := <-subscription.Events:
		t.Fatalf("unexpected per-item event: %+v", event)
	default:
	}
	if got := replayEvents(store); len(got) != 3 {
		t.Fatalf("replay contains %d events, want 3", len(got))
	}
}

func TestValidCursorReplaysMissedEvents(t *testing.T) {
	store := newStore("runtime-a", 4, 4)
	createTestJob(t, store, "job_1", 1)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}

	subscription, err := store.Subscribe(context.Background(), &EventCursor{RuntimeID: "runtime-a", Cursor: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	if subscription.Snapshot != nil || len(subscription.Replay) != 1 {
		t.Fatalf("subscription=%+v", subscription)
	}
	if subscription.Replay[0].Cursor != 2 || subscription.Replay[0].Job.Status != StatusRunning {
		t.Fatalf("replay=%+v", subscription.Replay)
	}
}

func TestReplayBufferGapReturnsResetSnapshot(t *testing.T) {
	store := newStore("runtime-a", 2, 4)
	createTestJob(t, store, "job_1", 1)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	if err := store.RequestCancel(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	subscription, err := store.Subscribe(context.Background(), &EventCursor{RuntimeID: "runtime-a", Cursor: 0})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	if subscription.Snapshot == nil || !subscription.Snapshot.Reset || len(subscription.Snapshot.Jobs) != 1 {
		t.Fatalf("snapshot=%+v", subscription.Snapshot)
	}
}

func TestRuntimeChangeReturnsResetSnapshot(t *testing.T) {
	store := newStore("runtime-b", 4, 4)
	subscription, err := store.Subscribe(context.Background(), &EventCursor{RuntimeID: "runtime-a", Cursor: 7})
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	if subscription.Snapshot == nil || !subscription.Snapshot.Reset || subscription.Snapshot.RuntimeID != "runtime-b" {
		t.Fatalf("snapshot=%+v", subscription.Snapshot)
	}
}

func TestFreshSubscriptionNeverReceivesTerminalHistory(t *testing.T) {
	store := newStore("runtime-a", 8, 8)
	createTestJob(t, store, "job_1", 0)
	if err := store.Finish(context.Background(), "job_1", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	if subscription.Snapshot == nil || len(subscription.Snapshot.Jobs) != 0 || len(subscription.Replay) != 0 {
		t.Fatalf("subscription=%+v", subscription)
	}
}

func TestOverflowingSubscriberIsClosedAndCanReplay(t *testing.T) {
	store := newStore("runtime-a", 8, 1)
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	createTestJob(t, store, "job_1", 1)
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	first, open := <-subscription.Events
	if !open || first.Cursor != 1 {
		t.Fatalf("first=%+v open=%v", first, open)
	}
	if _, open := <-subscription.Events; open {
		t.Fatal("overflowing subscription remained open")
	}
	reconnected, err := store.Subscribe(context.Background(), &EventCursor{RuntimeID: "runtime-a", Cursor: first.Cursor})
	if err != nil {
		t.Fatal(err)
	}
	defer reconnected.Unsubscribe()
	if len(reconnected.Replay) != 1 || reconnected.Replay[0].Cursor != 2 {
		t.Fatalf("replay=%+v", reconnected.Replay)
	}
}

func TestSnapshotAndSubscriptionRegistrationDoNotLoseNextEvent(t *testing.T) {
	store := newStore("runtime-a", 8, 8)
	createTestJob(t, store, "job_1", 1)
	subscription, err := store.Subscribe(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer subscription.Unsubscribe()
	if subscription.Snapshot == nil || subscription.Snapshot.Cursor != 1 {
		t.Fatalf("snapshot=%+v", subscription.Snapshot)
	}
	if err := store.MarkRunning(context.Background(), "job_1"); err != nil {
		t.Fatal(err)
	}
	event := <-subscription.Events
	if event.Cursor != 2 || event.Job.Status != StatusRunning {
		t.Fatalf("event=%+v", event)
	}
}
