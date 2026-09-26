package jobs

import (
	"context"
	"encoding/json"
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

func TestFolderTransferKeepsRateAcrossFilesButResetsForAnotherFolder(t *testing.T) {
	ctx := context.Background()
	s := NewStore()
	now := time.Now()
	s.state.now = func() time.Time { return now }
	_ = s.Create(ctx, Job{ID: "folder"})
	// Decode the wire payload to exercise the Python -> Go progress contract.
	report := func(payload string) TransferProgress {
		var p TransferProgress
		if err := json.Unmarshal([]byte(payload), &p); err != nil {
			t.Fatal(err)
		}
		if err := s.ReportTransfer(ctx, "folder", p); err != nil {
			t.Fatal(err)
		}
		job, _ := s.Get(ctx, "folder")
		return *job.Transfer
	}
	report(`{"phase":"download","scope":"folder-1","file":"a.txt","bytesDone":0,"bytesTotal":1000,"cancelable":true}`)
	now = now.Add(time.Second)
	p := report(`{"phase":"download","scope":"folder-1","file":"b.txt","bytesDone":200,"bytesTotal":1000,"cancelable":true}`)
	if p.BytesPerSecond != 200 || p.RemainingSeconds == nil || *p.RemainingSeconds != 4 {
		t.Fatalf("folder rate reset on next file: %+v", p)
	}
	now = now.Add(time.Second)
	p = report(`{"phase":"download","scope":"folder-2","file":"b.txt","bytesDone":200,"bytesTotal":1000,"cancelable":true}`)
	if p.BytesPerSecond != 0 || p.RemainingSeconds != nil {
		t.Fatalf("previous folder rate survived: %+v", p)
	}
}

func TestTransferFileCountsSurviveWorkerPayloadAndJobSnapshot(t *testing.T) {
	s := NewStore()
	ctx := context.Background()
	_ = s.Create(ctx, Job{ID: "counts"})
	var p TransferProgress
	if err := json.Unmarshal([]byte(`{"phase":"download","scope":"folder","file":"a.txt","bytesDone":100,"bytesTotal":1000,"filesDone":22,"filesTotal":266,"cancelable":true}`), &p); err != nil {
		t.Fatal(err)
	}
	if err := s.ReportTransfer(ctx, "counts", p); err != nil {
		t.Fatal(err)
	}
	job, _ := s.Get(ctx, "counts")
	raw, _ := json.Marshal(job.Transfer)
	var value map[string]any
	_ = json.Unmarshal(raw, &value)
	if value["filesDone"] != float64(22) || value["filesTotal"] != float64(266) {
		t.Fatalf("file counts lost: %s", raw)
	}
}
