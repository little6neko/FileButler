package jobs

import (
	"context"
	"errors"
	"sync"
)

type Event struct {
	RuntimeID string       `json:"runtimeId"`
	Cursor    int64        `json:"cursor"`
	Job       Job          `json:"job"`
	Item      *ItemResult  `json:"item,omitempty"`
	Items     []ItemResult `json:"items"`
}

type EventCursor struct {
	RuntimeID string
	Cursor    int64
}

type Subscription struct {
	Snapshot    *Snapshot
	Replay      []Event
	Events      <-chan Event
	Unsubscribe func()
}

func (s Store) Subscribe(ctx context.Context, cursor *EventCursor) (Subscription, error) {
	if err := ctx.Err(); err != nil {
		return Subscription{}, err
	}
	if s.state == nil {
		return Subscription{}, errors.New("job store is unavailable")
	}
	s.state.mu.Lock()
	id := s.state.nextSubscriberID
	s.state.nextSubscriberID++
	channel := make(chan Event, s.state.subscriberQueue)
	s.state.subscribers[id] = channel

	var snapshot *Snapshot
	var replay []Event
	switch {
	case cursor == nil:
		value := s.state.snapshotLocked(false)
		snapshot = &value
	case !s.state.canReplayLocked(*cursor):
		value := s.state.snapshotLocked(true)
		snapshot = &value
	default:
		for _, event := range s.state.replay {
			if event.Cursor > cursor.Cursor {
				replay = append(replay, cloneEvent(event))
			}
		}
	}
	s.state.mu.Unlock()

	var once sync.Once
	unsubscribe := func() {
		once.Do(func() {
			s.state.mu.Lock()
			if current, exists := s.state.subscribers[id]; exists && current == channel {
				delete(s.state.subscribers, id)
				close(channel)
			}
			s.state.mu.Unlock()
		})
	}
	return Subscription{Snapshot: snapshot, Replay: replay, Events: channel, Unsubscribe: unsubscribe}, nil
}

func (state *storeState) canReplayLocked(cursor EventCursor) bool {
	if cursor.RuntimeID != state.runtimeID || cursor.Cursor < 0 || cursor.Cursor > state.cursor {
		return false
	}
	if cursor.Cursor == state.cursor {
		return true
	}
	if len(state.replay) == 0 {
		return false
	}
	return cursor.Cursor >= state.replay[0].Cursor-1
}

func (state *storeState) publishLocked(event Event) {
	state.replay = append(state.replay, cloneEvent(event))
	if overflow := len(state.replay) - state.replayCapacity; overflow > 0 {
		state.replay = append([]Event(nil), state.replay[overflow:]...)
	}
	for id, subscriber := range state.subscribers {
		select {
		case subscriber <- cloneEvent(event):
		default:
			delete(state.subscribers, id)
			close(subscriber)
		}
	}
}

func cloneEvent(event Event) Event {
	cloned := event
	if event.Item != nil {
		item := *event.Item
		cloned.Item = &item
	}
	if event.Items != nil {
		cloned.Items = append(make([]ItemResult, 0, len(event.Items)), event.Items...)
	}
	return cloned
}
