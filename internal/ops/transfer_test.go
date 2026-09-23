package ops

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/jobs"
)

func TestCopyReportsBytesAndRemovesCanceledFile(t *testing.T) {
	dir := t.TempDir()
	src, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
	if err := os.WriteFile(src, make([]byte, 1024*1024), 0600); err != nil {
		t.Fatal(err)
	}
	var last int64
	ctx := jobs.WithReporter(context.Background(), func(p jobs.TransferProgress) error {
		last = p.BytesDone
		if last > 0 {
			return context.Canceled
		}
		return nil
	})
	if !errors.Is(copyFileContext(ctx, src, dest, 0600), context.Canceled) {
		t.Fatal("copy not canceled")
	}
	if last == 0 || last >= 1024*1024 {
		t.Fatal("cancellation did not interrupt copy")
	}
	if _, err := os.Stat(dest); !os.IsNotExist(err) {
		t.Fatal("partial file survived cancellation")
	}
	ctx = jobs.WithReporter(context.Background(), func(p jobs.TransferProgress) error { last = p.BytesDone; return nil })
	if err := copyFileContext(ctx, src, dest, 0600); err != nil {
		t.Fatal(err)
	}
	if last != 1024*1024 {
		t.Fatal("missing final byte count")
	}
}
