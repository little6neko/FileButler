package cloud115

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
)

type batchTestProvider struct {
	second, release chan struct{}
	scans           atomic.Int32
}

func (p *batchTestProvider) Call(ctx context.Context, method string, value any, report jobs.Reporter) (json.RawMessage, error) {
	args := value.(map[string]any)
	if method == "transfer.statistics" {
		p.scans.Add(1)
		return json.RawMessage(`{"files":2,"bytes":6}`), nil
	}
	if args["id"] == "1" {
		_ = report(jobs.TransferProgress{Phase: "download", FileID: "1", File: "a", BytesDone: 4, BytesTotal: 4, FileComplete: true})
	} else {
		_ = report(jobs.TransferProgress{Phase: "download", FileID: "2", File: "b", BytesDone: 2, BytesTotal: 6})
		close(p.second)
		<-p.release
		_ = report(jobs.TransferProgress{Phase: "download", FileID: "2", File: "b", BytesDone: 6, BytesTotal: 6, FileComplete: true})
		_ = report(jobs.TransferProgress{Phase: "download", FileID: "3", File: "empty", FileComplete: true})
	}
	return json.RawMessage(`{"ok":true}`), nil
}

func TestDownloadJobTotalsSpanAllSelectedItems(t *testing.T) {
	p := &batchTestProvider{second: make(chan struct{}), release: make(chan struct{})}
	s := NewService(p, jobs.NewStore(), roots.NewResolver(nil))
	ctx := context.Background()
	if err := s.Store.Create(ctx, jobs.Job{ID: "batch", Type: "download", ProgressTotal: 2}); err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() {
		defer close(finished)
		s.run("batch", "download", map[string]any{"accountId": "7"}, []map[string]any{{"id": "1"}, {"id": "folder"}})
	}()
	defer func() { close(p.release); <-finished }()
	<-p.second
	job, _ := s.Store.Get(ctx, "batch")
	if job.Transfer.FilesTotal != nil {
		t.Fatal("statistics ran before delay")
	}
	deadline := time.Now().Add(time.Second)
	for {
		job, _ = s.Store.Get(ctx, "batch")
		if job.Transfer.FilesTotal != nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing batch statistics")
		}
		time.Sleep(time.Millisecond)
	}
	if job.Transfer.BytesTotal != 10 || job.Transfer.BytesDone != 6 || *job.Transfer.FilesTotal != 3 || *job.Transfer.FilesDone != 1 {
		t.Fatalf("bad totals: %+v", job.Transfer)
	}
	if p.scans.Load() != 1 {
		t.Fatal("completed item redundantly scanned")
	}
}

func TestSameAccountMoveNeverStartsRecursiveStatistics(t *testing.T) {
	s := NewService(&stubProvider{}, jobs.NewStore(), roots.NewResolver(nil))
	args := map[string]any{"type": "move", "sourceCloud": true, "targetCloud": true}
	if b := s.transferBatch(context.Background(), "unused", "ops.execute", nil, []map[string]any{args}); b != nil {
		b.Close()
		t.Fatal("same-account move must not scan")
	}
	for _, tc := range []struct {
		method string
		args   map[string]any
	}{
		{"download", nil}, {"upload", nil},
		{"ops.execute", map[string]any{"type": "move", "sourceCloud": true, "targetCloud": false}},
		{"ops.execute", map[string]any{"type": "copy", "sourceCloud": true, "targetCloud": true}},
	} {
		if !isBatchTransfer(tc.method, tc.args) {
			t.Fatalf("missing batch path: %s %+v", tc.method, tc.args)
		}
	}
}
