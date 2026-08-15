package jobs

import "sync"

const defaultSubscriberBuffer = 64

type Event struct {
	Job  Job         `json:"job"`
	Item *ItemResult `json:"item,omitempty"`
}

type Publisher interface {
	Publish(Event)
}

// Broker orders committed events by their persistent event version. If a
// subscriber cannot keep up, its channel is closed so the client reconnects
// and recovers from a database snapshot instead of silently missing events.
type Broker struct {
	mu             sync.Mutex
	nextSubscriber uint64
	nextVersion    int64
	bufferSize     int
	subscribers    map[uint64]chan Event
	pending        map[int64]Event
}

func NewBroker(nextVersion int64) *Broker {
	return newBroker(nextVersion, defaultSubscriberBuffer)
}

func newBroker(nextVersion int64, bufferSize int) *Broker {
	if nextVersion < 1 {
		nextVersion = 1
	}
	if bufferSize < 1 {
		bufferSize = 1
	}
	return &Broker{
		nextVersion: nextVersion,
		bufferSize:  bufferSize,
		subscribers: make(map[uint64]chan Event),
		pending:     make(map[int64]Event),
	}
}

func (b *Broker) Subscribe() (<-chan Event, func()) {
	b.mu.Lock()
	id := b.nextSubscriber
	b.nextSubscriber++
	ch := make(chan Event, b.bufferSize)
	b.subscribers[id] = ch
	b.mu.Unlock()

	var once sync.Once
	return ch, func() {
		once.Do(func() {
			b.mu.Lock()
			if current, ok := b.subscribers[id]; ok && current == ch {
				delete(b.subscribers, id)
				close(ch)
			}
			b.mu.Unlock()
		})
	}
}

func (b *Broker) Publish(event Event) {
	version := event.Job.EventVersion
	b.mu.Lock()
	defer b.mu.Unlock()
	if version < b.nextVersion {
		return
	}
	if _, exists := b.pending[version]; !exists {
		b.pending[version] = event
	}
	for {
		next, ok := b.pending[b.nextVersion]
		if !ok {
			return
		}
		delete(b.pending, b.nextVersion)
		b.nextVersion++
		for id, subscriber := range b.subscribers {
			select {
			case subscriber <- next:
			default:
				delete(b.subscribers, id)
				close(subscriber)
			}
		}
	}
}
