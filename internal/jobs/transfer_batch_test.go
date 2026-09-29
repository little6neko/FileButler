package jobs

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type progressLog struct {
	sync.Mutex
	values []TransferProgress
}

func (l *progressLog) report(p TransferProgress) error {
	l.Lock()
	defer l.Unlock()
	l.values = append(l.values, p)
	return nil
}
func (l *progressLog) last() TransferProgress {
	l.Lock()
	defer l.Unlock()
	return l.values[len(l.values)-1]
}
func waitBatch(t *testing.T, ready func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for !ready() {
		if time.Now().After(deadline) {
			t.Fatal("timed out")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestBatchFastTaskSkipsStatistics(t *testing.T) {
	var calls atomic.Int32
	log := &progressLog{}
	b := NewTransferBatch(context.Background(), 1, log.report, func(context.Context, int, bool) (TransferTotals, error) { calls.Add(1); return TransferTotals{}, nil })
	if p := log.last(); p.FilesTotal != nil || p.BytesTotal != 0 {
		t.Fatalf("guessed totals: %+v", p)
	}
	b.Close()
	time.Sleep(120 * time.Millisecond)
	if calls.Load() != 0 {
		t.Fatal("fast task started statistics")
	}
}

func TestBatchMixedFilesAndFolderAccumulateWithoutReset(t *testing.T) {
	log := &progressLog{}
	release := make(chan struct{})
	b := newTransferBatch(context.Background(), 2, log.report, func(ctx context.Context, i int, _ bool) (TransferTotals, error) {
		select {
		case <-release:
		case <-ctx.Done():
			return TransferTotals{}, ctx.Err()
		}
		if i == 0 {
			return TransferTotals{Bytes: 4, Files: 1}, nil
		}
		return TransferTotals{Bytes: 6, Files: 2}, nil
	}, 0)
	defer b.Close()
	_ = b.Report(0, TransferProgress{Phase: "download", File: "same.txt", FileID: "1", BytesDone: 4, BytesTotal: 4, FileComplete: true})
	b.CompleteItem(0, nil)
	_ = b.Report(1, TransferProgress{Phase: "download", File: "same.txt", FileID: "2", BytesDone: 2, BytesTotal: 6})
	if log.last().FilesTotal != nil {
		t.Fatal("partial inventory published")
	}
	close(release)
	waitBatch(t, func() bool { return log.last().FilesTotal != nil })
	p := log.last()
	if p.BytesTotal != 10 || p.BytesDone != 6 || *p.FilesTotal != 3 || *p.FilesDone != 1 {
		t.Fatalf("not batch totals: %+v", p)
	}
	_ = b.Report(1, TransferProgress{Phase: "download", File: "same.txt", FileID: "2", BytesDone: 6, BytesTotal: 6, FileComplete: true})
	_ = b.Report(1, TransferProgress{Phase: "download", File: "empty", FileID: "3", FileComplete: true})
	_ = b.Report(1, TransferProgress{Phase: "download", File: "empty", FileID: "3", FileComplete: true})
	p = log.last()
	if p.BytesDone != 10 || *p.FilesDone != 3 {
		t.Fatalf("double counted/zero file lost: %+v", p)
	}
}

func TestBatchCloseCancelsScanAndDropsLateResults(t *testing.T) {
	started, canceled, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	log := &progressLog{}
	b := newTransferBatch(context.Background(), 1, log.report, func(ctx context.Context, _ int, _ bool) (TransferTotals, error) {
		close(started)
		<-ctx.Done()
		close(canceled)
		<-release
		return TransferTotals{Bytes: 100, Files: 2}, nil
	}, 0)
	<-started
	b.Close() // Must not join the slow scanner.
	<-canceled
	close(release)
	time.Sleep(5 * time.Millisecond)
	if log.last().FilesTotal != nil {
		t.Fatal("late statistics published after completion")
	}
}

func TestBatchMoveUsesRecordedLeavesWhenSourceDisappears(t *testing.T) {
	log := &progressLog{}
	started, release := make(chan struct{}), make(chan struct{})
	b := newTransferBatch(context.Background(), 1, log.report, func(context.Context, int, bool) (TransferTotals, error) {
		close(started)
		<-release
		return TransferTotals{}, errors.New("source removed")
	}, 0)
	defer b.Close()
	<-started
	_ = b.Report(0, TransferProgress{Phase: "copy", FileID: "source/a", BytesDone: 7, BytesTotal: 7, FileComplete: true})
	_ = b.Report(0, TransferProgress{Phase: "delete-source", File: "a"})
	close(release)
	waitBatch(t, func() bool { return log.last().FilesTotal != nil })
	p := log.last()
	if p.BytesTotal != 7 || p.BytesDone != 7 || *p.FilesTotal != 1 || *p.FilesDone != 1 {
		t.Fatalf("lost moved file: %+v", p)
	}
}

func TestBatchAtomicMoveAndEmptyFolder(t *testing.T) {
	log := &progressLog{}
	b := newTransferBatch(context.Background(), 2, log.report, func(context.Context, int, bool) (TransferTotals, error) {
		return TransferTotals{Files: 5, Bytes: 20}, nil
	}, 0)
	defer b.Close()
	// Second item is an empty folder; no leaf completion events are necessary.
	b.CompleteItem(1, nil)
	_ = b.Report(0, TransferProgress{Phase: "waiting", AtomicMove: true})
	b.CompleteItem(0, nil)
	waitBatch(t, func() bool { return log.last().FilesTotal != nil })
	p := log.last()
	if *p.FilesTotal != 5 || *p.FilesDone != 5 || p.BytesDone != 20 || p.BytesTotal != 20 {
		t.Fatalf("atomic move: %+v", p)
	}
}

func TestBatchHashProgressDoesNotCountAsUploadedBytes(t *testing.T) {
	log := &progressLog{}
	b := newTransferBatch(context.Background(), 1, log.report, func(context.Context, int, bool) (TransferTotals, error) {
		return TransferTotals{Bytes: 10, Files: 1}, nil
	}, 0)
	defer b.Close()
	waitBatch(t, func() bool { return log.last().FilesTotal != nil })
	_ = b.Report(0, TransferProgress{Phase: "hash", FileID: "a", BytesDone: 5, BytesTotal: 10})
	p := log.last()
	if p.BytesDone != 0 || p.Stage == nil || p.Stage.BytesDone != 5 || p.Stage.BytesTotal != 10 {
		t.Fatalf("hash included in uploaded bytes: %+v", p)
	}
	_ = b.Report(0, TransferProgress{Phase: "upload", FileID: "a", BytesDone: 10, BytesTotal: 10, FileComplete: true})
	b.CompleteItem(0, nil)
	b.Close()
	p = log.last()
	if p.BytesDone != 10 || p.Stage != nil || *p.Percent != 100 || *p.FilesDone != 1 {
		t.Fatalf("instant upload completion: %+v", p)
	}
}

func TestBatchFailedScanKeepsTotalsUnknown(t *testing.T) {
	log := &progressLog{}
	scanned := make(chan struct{})
	b := newTransferBatch(context.Background(), 2, log.report, func(context.Context, int, bool) (TransferTotals, error) {
		select {
		case <-scanned:
		default:
			close(scanned)
		}
		return TransferTotals{Files: 2, Bytes: 20}, errors.New("partial listing")
	}, 0)
	defer b.Close()
	<-scanned
	_ = b.Report(0, TransferProgress{Phase: "copy", FileID: "a", BytesDone: 4, BytesTotal: 4, FileComplete: true})
	if log.last().FilesTotal != nil || log.last().BytesTotal != 0 {
		t.Fatal("partial scan was displayed as total")
	}
}
