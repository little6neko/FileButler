package jobs

import (
	"context"
	"errors"
	"sync"
	"time"
)

// TransferTotals is metadata only. Counting must never read file contents.
type TransferTotals struct {
	Bytes int64 `json:"bytes"`
	Files int   `json:"files"`
}

type batchFile struct {
	size, done int64
	complete   bool
}
type batchItem struct {
	files                             map[string]batchFile
	total                             *TransferTotals
	finished, success, atomic, sealed bool
	observedBytes, doneBytes          int64
	doneFiles                         int
}

// TransferBatch owns one job's display progress. Item completion/error handling
// stays with the runner; a slow or failed scan must never hold up that runner.
type TransferBatch struct {
	mu        sync.Mutex
	cancel    context.CancelFunc
	items     []batchItem
	report    Reporter
	last      TransferProgress
	closed    bool
	hashItem  int
	hashID    string
	hashAt    time.Time
	hashStart int64
}

func NewTransferBatch(ctx context.Context, count int, report Reporter, scan func(context.Context, int, bool) (TransferTotals, error)) *TransferBatch {
	return newTransferBatch(ctx, count, report, scan, 100*time.Millisecond)
}

func newTransferBatch(ctx context.Context, count int, report Reporter, scan func(context.Context, int, bool) (TransferTotals, error), delay time.Duration) *TransferBatch {
	ctx, cancel := context.WithCancel(ctx)
	b := &TransferBatch{cancel: cancel, items: make([]batchItem, count), report: report, last: TransferProgress{Phase: "scan", Cancelable: true}}
	for i := range b.items {
		b.items[i].files = make(map[string]batchFile)
	}
	_ = b.emitLocked()
	go func() {
		timer := time.NewTimer(delay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		for i := range b.items {
			if ctx.Err() != nil {
				return
			}
			b.mu.Lock()
			known := b.observedTotal(i)
			moved := b.items[i].atomic && b.items[i].finished && b.items[i].success
			b.mu.Unlock()
			var total TransferTotals
			var err error
			if known != nil {
				total = *known
			} else {
				total, err = scan(ctx, i, moved)
			}
			b.mu.Lock()
			if !moved && b.items[i].atomic && b.items[i].finished && b.items[i].success && ctx.Err() == nil {
				// Rename raced the source scan. Only a confirmed successful move
				// permits scanning the destination, never an unrelated existing path.
				b.mu.Unlock()
				total, err = scan(ctx, i, true)
				b.mu.Lock()
			}
			if b.closed || ctx.Err() != nil {
				b.mu.Unlock()
				return
			}
			// A completed transfer is authoritative even if deletion raced the scan.
			if observed := b.observedTotal(i); observed != nil {
				total, err = *observed, nil
			}
			if err == nil && total.Bytes >= 0 && total.Files >= 0 {
				b.items[i].total = &total
			}
			_ = b.emitLocked()
			b.mu.Unlock()
		}
	}()
	return b
}

func (b *TransferBatch) observedTotal(i int) *TransferTotals {
	item := &b.items[i]
	if item.atomic || !(item.sealed || item.finished && item.success) {
		return nil
	}
	return &TransferTotals{Files: len(item.files), Bytes: item.observedBytes}
}

func (b *TransferBatch) Report(i int, p TransferProgress) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return context.Canceled
	}
	if p.BytesDone < 0 || p.BytesTotal < 0 || p.BytesTotal > 0 && p.BytesDone > p.BytesTotal {
		return errors.New("invalid byte progress")
	}
	if p.Phase == "hash" {
		now := time.Now()
		if b.hashAt.IsZero() || b.hashItem != i || b.hashID != p.FileID || p.BytesDone < b.hashStart {
			b.hashItem, b.hashID, b.hashAt, b.hashStart = i, p.FileID, now, p.BytesDone
		}
		p.Stage = &TransferStage{BytesDone: p.BytesDone, BytesTotal: p.BytesTotal}
		if elapsed := now.Sub(b.hashAt).Seconds(); elapsed > 0 {
			p.Stage.BytesPerSecond = float64(p.BytesDone-b.hashStart) / elapsed
		}
	} else {
		b.hashAt = time.Time{}
	}
	item := &b.items[i]
	if p.AtomicMove {
		item.atomic = true
	}
	if p.Phase == "delete-source" {
		item.sealed = true
	}
	if p.FileID != "" {
		f := item.files[p.FileID]
		old := f
		f.size = p.BytesTotal
		if p.Phase == "copy" || p.Phase == "download" || p.Phase == "upload" || p.FileComplete {
			f.done = p.BytesDone
		}
		f.complete = f.complete || p.FileComplete
		item.files[p.FileID] = f
		item.observedBytes += f.size - old.size
		item.doneBytes += f.done - old.done
		if f.complete && !old.complete {
			item.doneFiles++
		}
	}
	b.last = p
	return b.emitLocked()
}

func (b *TransferBatch) CompleteItem(i int, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.items[i].finished, b.items[i].success = true, err == nil
	if observed := b.observedTotal(i); observed != nil && b.items[i].total != nil {
		b.items[i].total = observed
	}
	_ = b.emitLocked()
}

func (b *TransferBatch) emitLocked() error {
	p := b.last
	p.Scope = "batch"
	p.FileID, p.FileComplete, p.AtomicMove = "", false, false
	p.BytesDone, p.BytesTotal = 0, 0
	p.FilesDone, p.FilesTotal, p.Percent = nil, nil, nil
	done, total := 0, 0
	known := true
	complete := b.closed
	for _, item := range b.items {
		complete = complete && item.finished && item.success
		p.BytesDone += item.doneBytes
		done += item.doneFiles
		if item.total == nil {
			known = false
			continue
		}
		if len(item.files) > item.total.Files || item.observedBytes > item.total.Bytes {
			known = false
		}
		total += item.total.Files
		p.BytesTotal += item.total.Bytes
		if item.atomic && item.finished && item.success {
			done += item.total.Files
			p.BytesDone += item.total.Bytes
		}
	}
	if known && p.BytesDone <= p.BytesTotal && done <= total {
		p.FilesDone, p.FilesTotal = &done, &total
		percent := 0.0
		if p.BytesTotal > 0 {
			percent = min(99.9, float64(p.BytesDone)/float64(p.BytesTotal)*100)
		}
		if complete && done == total && p.BytesDone == p.BytesTotal {
			percent = 100
		}
		p.Percent = &percent
	} else {
		p.BytesTotal = 0
	}
	return b.report(p)
}

// Close stops the timer/scanner without waiting for a pending filesystem or API
// call. Late results are discarded, including results racing a terminal event.
func (b *TransferBatch) Close() {
	b.cancel()
	b.mu.Lock()
	if b.closed {
		b.mu.Unlock()
		return
	}
	b.closed = true
	_ = b.emitLocked()
	b.mu.Unlock()
}
