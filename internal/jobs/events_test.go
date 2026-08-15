package jobs

import "testing"

func TestBrokerPublishesCommittedVersionsInOrder(t *testing.T) {
	broker := newBroker(1, 4)
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	broker.Publish(Event{Job: Job{ID: "job_2", EventVersion: 2}})
	select {
	case event := <-events:
		t.Fatalf("received version %d before version 1", event.Job.EventVersion)
	default:
	}

	broker.Publish(Event{Job: Job{ID: "job_1", EventVersion: 1}})
	for _, want := range []int64{1, 2} {
		event, ok := <-events
		if !ok {
			t.Fatalf("subscription closed before version %d", want)
		}
		if event.Job.EventVersion != want {
			t.Fatalf("event version = %d, want %d", event.Job.EventVersion, want)
		}
	}
}

func TestBrokerClosesOverflowingSubscription(t *testing.T) {
	broker := newBroker(1, 1)
	events, unsubscribe := broker.Subscribe()
	defer unsubscribe()

	broker.Publish(Event{Job: Job{EventVersion: 1}})
	broker.Publish(Event{Job: Job{EventVersion: 2}})

	if event, ok := <-events; !ok || event.Job.EventVersion != 1 {
		t.Fatalf("buffered event = %+v, open=%v", event, ok)
	}
	if _, ok := <-events; ok {
		t.Fatal("overflowing subscription remained open")
	}

	// Publishing after overflow and unsubscribing twice must remain safe.
	broker.Publish(Event{Job: Job{EventVersion: 3}})
	unsubscribe()
}

func TestBrokerUnsubscribeClosesSubscription(t *testing.T) {
	broker := newBroker(1, 1)
	events, unsubscribe := broker.Subscribe()
	unsubscribe()
	if _, ok := <-events; ok {
		t.Fatal("subscription remained open after unsubscribe")
	}
}
