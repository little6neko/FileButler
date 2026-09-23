package jobs

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestTransferRateResetAndTerminalGuard(t *testing.T) {
	ctx := context.Background()
	s := NewStore()
	now := time.Now()
	s.state.now = func() time.Time { return now }
	if err := s.Create(ctx, Job{ID: "transfer"}); err != nil {
		t.Fatal(err)
	}
	p := TransferProgress{Phase: "hash", File: "a", BytesTotal: 1000, Cancelable: true}
	if err := s.ReportTransfer(ctx, "transfer", p); err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	p.BytesDone = 200
	if err := s.ReportTransfer(ctx, "transfer", p); err != nil {
		t.Fatal(err)
	}
	job, _ := s.Get(ctx, "transfer")
	if job.Transfer.BytesPerSecond != 200 || job.Transfer.RemainingSeconds == nil || *job.Transfer.RemainingSeconds != 4 {
		t.Fatalf("unexpected progress: %+v", job.Transfer)
	}
	p.Phase, p.BytesDone = "upload", 0
	if err := s.ReportTransfer(ctx, "transfer", p); err != nil {
		t.Fatal(err)
	}
	job, _ = s.Get(ctx, "transfer")
	if job.Transfer.BytesPerSecond != 0 || job.Transfer.RemainingSeconds != nil {
		t.Fatal("old phase rate survived")
	}
	if err := s.Finish(ctx, "transfer", StatusCompleted, ""); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(s.ReportTransfer(ctx, "transfer", p), ErrJobNotFound) {
		t.Fatal("late progress accepted")
	}
}

func TestTransferCancellation(t *testing.T) {
	ctx := context.Background()
	s := NewStore()
	_ = s.Create(ctx, Job{ID: "transfer"})
	p := TransferProgress{Phase: "extract", Cancelable: false}
	_ = s.ReportTransfer(ctx, "transfer", p)
	if s.RequestCancel(ctx, "transfer") == nil {
		t.Fatal("uncancelable phase accepted cancellation")
	}
	p.Cancelable = true
	_ = s.ReportTransfer(ctx, "transfer", p)
	if err := s.RequestCancel(ctx, "transfer"); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(s.ReportTransfer(ctx, "transfer", p), context.Canceled) {
		t.Fatal("cancel was not propagated")
	}
}
