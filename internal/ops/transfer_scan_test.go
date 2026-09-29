package ops

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestLocalTreeStatisticsAndLeafCompletion(t *testing.T) {
	a, b, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(a, "folder/a.txt"), "1234")
	testutil.WriteFile(t, filepath.Join(a, "folder/sub/a.txt"), "123456")
	testutil.WriteFile(t, filepath.Join(a, "folder/empty.txt"), "")
	if err := os.Mkdir(filepath.Join(a, "folder/empty-dir"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("a.txt", filepath.Join(a, "folder/link")); err != nil {
		t.Fatal(err)
	}
	item := jobs.ExecutableItem{Action: "copy", SourceRoot: "a", SourcePath: "folder", DestRoot: "b", DestPath: "folder"}
	jobExecutor := JobExecutor{executor}
	total, err := jobExecutor.ScanTransfer(context.Background(), item, false)
	if err != nil || total.Files != 4 || total.Bytes != 10 {
		t.Fatalf("%+v %v", total, err)
	}
	done := map[string]int64{}
	ctx := jobs.WithReporter(context.Background(), func(p jobs.TransferProgress) error {
		if p.FileComplete {
			done[p.FileID] = p.BytesDone
		}
		return nil
	})
	if err := jobExecutor.ExecuteItem(ctx, item); err != nil {
		t.Fatal(err)
	}
	if len(done) != 4 {
		t.Fatalf("missing or duplicate leaves: %+v", done)
	}
	assertContent(t, filepath.Join(b, "folder/sub/a.txt"), "123456")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := jobExecutor.ScanTransfer(ctx, item, false); !errors.Is(err, context.Canceled) {
		t.Fatalf("scan not canceled: %v", err)
	}
}

type pausedLocalTransfer struct {
	JobExecutor
	started, release chan struct{}
	paused           bool
}

func (e *pausedLocalTransfer) ExecuteItem(ctx context.Context, item jobs.ExecutableItem) error {
	return e.JobExecutor.ExecuteItem(jobs.WithReporter(ctx, func(p jobs.TransferProgress) error {
		if err := jobs.Report(ctx, p); err != nil {
			return err
		}
		if p.FileComplete && !e.paused {
			e.paused = true
			close(e.started)
			<-e.release
		}
		return nil
	}), item)
}

func TestLocalRunnerAggregatesMixedSelection(t *testing.T) {
	a, _, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(a, "one"), "1234")
	testutil.WriteFile(t, filepath.Join(a, "folder/two"), "123456")
	testutil.WriteFile(t, filepath.Join(a, "folder/empty"), "")
	items := []jobs.ExecutableItem{
		{Action: "copy", SourceRoot: "a", SourcePath: "one", DestRoot: "b", DestPath: "one"},
		{Action: "copy", SourceRoot: "a", SourcePath: "folder", DestRoot: "b", DestPath: "folder"},
	}
	store := jobs.NewStore()
	ctx := context.Background()
	if err := store.Create(ctx, jobs.Job{ID: "test", Type: "copy", ProgressTotal: 2}); err != nil {
		t.Fatal(err)
	}
	paused := &pausedLocalTransfer{JobExecutor: JobExecutor{executor}, started: make(chan struct{}), release: make(chan struct{})}
	finished := make(chan error, 1)
	go func() { finished <- (jobs.Runner{Store: store, Executor: paused}).Run(ctx, "test", items) }()
	defer func() {
		close(paused.release)
		if err := <-finished; err != nil {
			t.Error(err)
		}
	}()
	<-paused.started
	deadline := time.Now().Add(time.Second)
	for {
		job, _ := store.Get(ctx, "test")
		if job.Transfer.FilesTotal != nil {
			if job.Transfer.BytesTotal != 10 || job.Transfer.BytesDone != 4 || *job.Transfer.FilesTotal != 3 || *job.Transfer.FilesDone != 1 {
				t.Fatalf("wrong total: %+v", job.Transfer)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("no aggregate progress")
		}
		time.Sleep(time.Millisecond)
	}
}

func TestDelayedMoveStatisticsUsePublishedDestination(t *testing.T) {
	a, _, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(a, "folder/file"), "123")
	item := jobs.ExecutableItem{Action: "move", SourceRoot: "a", SourcePath: "folder", DestRoot: "b", DestPath: "moved"}
	e := JobExecutor{executor}
	if err := e.ExecuteItem(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	total, err := e.ScanTransfer(context.Background(), item, true)
	if err != nil || total.Files != 1 || total.Bytes != 3 {
		t.Fatalf("%+v %v", total, err)
	}
}
