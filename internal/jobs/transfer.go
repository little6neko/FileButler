package jobs

import (
	"context"
	"errors"
	"math"
	"time"
)

// TransferProgress describes the current phase, not an estimate for later phases.
type TransferProgress struct {
	Scope            string   `json:"scope,omitempty"`
	Warning          string   `json:"warning,omitempty"`
	FilesDone        *int     `json:"filesDone,omitempty"`
	FilesTotal       *int     `json:"filesTotal,omitempty"`
	Percent          *float64 `json:"percent,omitempty"`
	Phase            string   `json:"phase"`
	File             string   `json:"file"`
	BytesDone        int64    `json:"bytesDone"`
	BytesTotal       int64    `json:"bytesTotal"`
	BytesPerSecond   float64  `json:"bytesPerSecond"`
	RemainingSeconds *int64   `json:"remainingSeconds,omitempty"`
	Cancelable       bool     `json:"cancelable"`
}

type progressKey struct{}
type Reporter func(TransferProgress) error

func WithReporter(ctx context.Context, reporter Reporter) context.Context {
	return context.WithValue(ctx, progressKey{}, reporter)
}

func Report(ctx context.Context, progress TransferProgress) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if report, ok := ctx.Value(progressKey{}).(Reporter); ok {
		return report(progress)
	}
	return nil
}

func (s Store) ReportTransfer(ctx context.Context, id string, progress TransferProgress) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if s.state == nil {
		return ErrJobNotFound
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	record, ok := s.state.active[id]
	if !ok {
		return ErrJobNotFound
	}
	if record.job.CancelRequested {
		return context.Canceled
	}
	if progress.BytesDone < 0 || progress.BytesTotal < 0 || (progress.BytesTotal > 0 && progress.BytesDone > progress.BytesTotal) {
		return errors.New("invalid byte progress")
	}
	now := s.state.currentTime()
	previous := record.job.Transfer
	reset := previous == nil || previous.Phase != progress.Phase || previous.Scope != progress.Scope || (progress.Scope == "" && previous.File != progress.File) || progress.BytesDone < previous.BytesDone
	if reset {
		record.transferSampleAt, record.transferSampleBytes = now, progress.BytesDone
		record.transferRate = 0
	} else if elapsed := now.Sub(record.transferSampleAt); elapsed >= 250*time.Millisecond {
		rate := float64(progress.BytesDone-record.transferSampleBytes) / elapsed.Seconds()
		if record.transferRate == 0 {
			record.transferRate = rate
		} else {
			record.transferRate = .5*rate + .5*record.transferRate
		}
		record.transferSampleAt, record.transferSampleBytes = now, progress.BytesDone
	}
	progress.BytesPerSecond = record.transferRate
	progress.RemainingSeconds = nil
	if progress.BytesTotal > 0 && progress.BytesPerSecond > 0 {
		remaining := int64(math.Ceil(float64(progress.BytesTotal-progress.BytesDone) / progress.BytesPerSecond))
		progress.RemainingSeconds = &remaining
	}
	record.job.Transfer = &progress
	record.job.UpdatedAtUnix = now.Unix()
	if reset || now.Sub(record.lastProgressEventAt) >= progressEventInterval {
		record.lastProgressEventAt = now
		s.state.emitLocked(record)
	}
	return nil
}
