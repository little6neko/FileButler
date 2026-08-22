package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"
)

const (
	defaultReplayCapacity  = 256
	defaultSubscriberQueue = 64
)

var (
	ErrJobNotFound   = errors.New("job not found")
	ErrDuplicateJob  = errors.New("job already exists")
	ErrDuplicateItem = errors.New("job item already exists")
)

type Store struct {
	state *storeState
}

type storeState struct {
	mu               sync.Mutex
	runtimeID        string
	cursor           int64
	active           map[string]*jobRecord
	replay           []Event
	replayCapacity   int
	subscriberQueue  int
	nextSubscriberID uint64
	subscribers      map[uint64]chan Event
	now              func() time.Time
}

type jobRecord struct {
	job   Job
	items map[int]ItemResult
}

func NewStore() Store {
	return newStore(newRuntimeID(), defaultReplayCapacity, defaultSubscriberQueue)
}

func newStore(runtimeID string, replayCapacity, subscriberQueue int) Store {
	if runtimeID == "" {
		runtimeID = newRuntimeID()
	}
	if replayCapacity < 1 {
		replayCapacity = 1
	}
	if subscriberQueue < 1 {
		subscriberQueue = 1
	}
	return Store{state: &storeState{
		runtimeID:       runtimeID,
		active:          make(map[string]*jobRecord),
		replayCapacity:  replayCapacity,
		subscriberQueue: subscriberQueue,
		subscribers:     make(map[uint64]chan Event),
		now:             time.Now,
	}}
}

func (s Store) Available() bool {
	return s.state != nil
}

func (s Store) Create(ctx context.Context, job Job) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return errors.New("job store is unavailable")
	}
	if job.ID == "" {
		return errors.New("job id is required")
	}
	if job.Status == "" {
		job.Status = StatusPending
	}
	if job.Status.IsTerminal() {
		return errors.New("new job status must be nonterminal")
	}

	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	if _, exists := s.state.active[job.ID]; exists {
		return ErrDuplicateJob
	}
	now := s.state.currentTime().Unix()
	if job.CreatedAtUnix == 0 {
		job.CreatedAtUnix = now
	}
	job.UpdatedAtUnix = now
	job.FinishedAtUnix = 0
	record := &jobRecord{job: job, items: make(map[int]ItemResult)}
	s.state.active[job.ID] = record
	s.state.emitLocked(record, nil, false)
	return nil
}

func (s Store) Get(ctx context.Context, id string) (Job, []ItemResult, error) {
	if err := ctx.Err(); err != nil {
		return Job{}, nil, err
	}
	if s.state == nil {
		return Job{}, nil, ErrJobNotFound
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists {
		return Job{}, nil, ErrJobNotFound
	}
	return record.job, sortedItems(record.items), nil
}

func (s Store) Snapshot(ctx context.Context) (Snapshot, error) {
	if err := ctx.Err(); err != nil {
		return Snapshot{}, err
	}
	if s.state == nil {
		return Snapshot{}, errors.New("job store is unavailable")
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	return s.state.snapshotLocked(false), nil
}

func (s Store) MarkRunning(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return nil
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists || record.job.Status != StatusPending {
		return nil
	}
	record.job.Status = StatusRunning
	record.job.UpdatedAtUnix = s.state.currentTime().Unix()
	s.state.emitLocked(record, nil, false)
	return nil
}

func (s Store) RecordItemResult(ctx context.Context, result ItemResult) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return ErrJobNotFound
	}
	if result.UndoJSON == "" {
		result.UndoJSON = "{}"
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[result.JobID]
	if !exists {
		return ErrJobNotFound
	}
	if _, exists := record.items[result.Index]; exists {
		return ErrDuplicateItem
	}
	record.items[result.Index] = result
	record.job.ProgressDone++
	record.job.UpdatedAtUnix = s.state.currentTime().Unix()
	s.state.emitLocked(record, &result, false)
	return nil
}

func (s Store) RequestCancel(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return nil
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists || (record.job.Status != StatusPending && record.job.Status != StatusRunning) {
		return nil
	}
	record.job.CancelRequested = true
	record.job.Status = StatusCancelRequested
	record.job.UpdatedAtUnix = s.state.currentTime().Unix()
	s.state.emitLocked(record, nil, false)
	return nil
}

func (s Store) IsCancelRequested(ctx context.Context, id string) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if s.state == nil {
		return false, ErrJobNotFound
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists {
		return false, ErrJobNotFound
	}
	return record.job.CancelRequested, nil
}

func (s Store) Finish(ctx context.Context, id string, status Status, message string) error {
	if !status.IsTerminal() {
		return errors.New("finish status must be terminal")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return nil
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists {
		return nil
	}
	now := s.state.currentTime().Unix()
	record.job.Status = status
	record.job.ErrorMessage = message
	record.job.UpdatedAtUnix = now
	record.job.FinishedAtUnix = now
	delete(s.state.active, id)
	s.state.emitLocked(record, nil, true)
	return nil
}

func (state *storeState) emitLocked(record *jobRecord, item *ItemResult, terminal bool) {
	state.cursor++
	record.job.EventVersion = state.cursor
	event := Event{
		RuntimeID: state.runtimeID,
		Cursor:    state.cursor,
		Job:       record.job,
	}
	if item != nil {
		cloned := *item
		event.Item = &cloned
	}
	if terminal {
		event.Items = sortedItems(record.items)
	}
	state.publishLocked(event)
}

func (state *storeState) snapshotLocked(reset bool) Snapshot {
	jobs := make([]JobDetail, 0, len(state.active))
	for _, record := range state.active {
		jobs = append(jobs, JobDetail{Job: record.job, Items: sortedItems(record.items)})
	}
	sort.Slice(jobs, func(left, right int) bool {
		if jobs[left].CreatedAtUnix != jobs[right].CreatedAtUnix {
			return jobs[left].CreatedAtUnix > jobs[right].CreatedAtUnix
		}
		if jobs[left].EventVersion != jobs[right].EventVersion {
			return jobs[left].EventVersion > jobs[right].EventVersion
		}
		return jobs[left].ID > jobs[right].ID
	})
	return Snapshot{RuntimeID: state.runtimeID, Cursor: state.cursor, Reset: reset, Jobs: jobs}
}

func (state *storeState) currentTime() time.Time {
	if state.now == nil {
		return time.Now().UTC()
	}
	return state.now().UTC()
}

func sortedItems(items map[int]ItemResult) []ItemResult {
	out := make([]ItemResult, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	sort.Slice(out, func(left, right int) bool { return out[left].Index < out[right].Index })
	return out
}

func newRuntimeID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err == nil {
		return hex.EncodeToString(buffer)
	}
	return fmt.Sprintf("runtime-%d", time.Now().UnixNano())
}
