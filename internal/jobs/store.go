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
	progressEventInterval  = 100 * time.Millisecond
)

var (
	ErrJobNotFound  = errors.New("job not found")
	ErrDuplicateJob = errors.New("job already exists")
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
	job                 Job
	firstItemError      string
	lastProgressEventAt time.Time
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
	record := &jobRecord{job: job}
	s.state.active[job.ID] = record
	s.state.emitLocked(record)
	return nil
}

func (s Store) Get(ctx context.Context, id string) (Job, error) {
	if err := ctx.Err(); err != nil {
		return Job{}, err
	}
	if s.state == nil {
		return Job{}, ErrJobNotFound
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists {
		return Job{}, ErrJobNotFound
	}
	return record.job, nil
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
	now := s.state.currentTime()
	record.job.Status = StatusRunning
	record.job.UpdatedAtUnix = now.Unix()
	record.lastProgressEventAt = now
	s.state.emitLocked(record)
	return nil
}

func (s Store) RecordProgress(ctx context.Context, id string, itemErr error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return ErrJobNotFound
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, exists := s.state.active[id]
	if !exists {
		return ErrJobNotFound
	}
	record.job.ProgressDone++
	if itemErr != nil {
		record.job.FailedCount++
		if record.firstItemError == "" {
			record.firstItemError = itemErr.Error()
		}
	}
	now := s.state.currentTime()
	record.job.UpdatedAtUnix = now.Unix()
	if record.lastProgressEventAt.IsZero() || now.Sub(record.lastProgressEventAt) >= progressEventInterval {
		record.lastProgressEventAt = now
		s.state.emitLocked(record)
	}
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
	s.state.emitLocked(record)
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
	if message == "" && status == StatusCompletedWithErrors {
		message = record.firstItemError
	}
	record.job.ErrorMessage = message
	record.job.UpdatedAtUnix = now
	record.job.FinishedAtUnix = now
	delete(s.state.active, id)
	s.state.emitLocked(record)
	return nil
}

func (state *storeState) emitLocked(record *jobRecord) {
	state.cursor++
	record.job.EventVersion = state.cursor
	event := Event{
		RuntimeID: state.runtimeID,
		Cursor:    state.cursor,
		Job:       record.job,
	}
	state.publishLocked(event)
}

func (state *storeState) snapshotLocked(reset bool) Snapshot {
	jobs := make([]Job, 0, len(state.active))
	for _, record := range state.active {
		jobs = append(jobs, record.job)
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

func newRuntimeID() string {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err == nil {
		return hex.EncodeToString(buffer)
	}
	return fmt.Sprintf("runtime-%d", time.Now().UnixNano())
}
