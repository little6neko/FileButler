package cloud115

import (
	"context"
	"errors"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/little6neko/filebutler/internal/jobs"
)

func TestInstalledProviderWithoutCredentials(t *testing.T) {
	python := os.Getenv("FILEBUTLER_TEST_PYTHON")
	if python == "" {
		t.Skip("set FILEBUTLER_TEST_PYTHON to test the installed p115client provider")
	}
	script, _ := filepath.Abs("../../cloud115/worker.py")
	db, err := storage.Open(filepath.Join(t.TempDir(), "filebutler.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	b := NewBridge(python, script, db, roots.NewResolver(nil))
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	data, err := b.Call(ctx, "status", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != `{"loggedIn": false}` {
		t.Fatalf("unexpected status: %s", data)
	}
}

func TestBridgeProgressCancellationAndRestart(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("python3 unavailable")
	}
	script, _ := filepath.Abs("testdata/worker.py")
	db, err := storage.Open(filepath.Join(t.TempDir(), "filebutler.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	b := NewBridge(python, script, db, roots.NewResolver(nil))
	defer b.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	seen := false
	_, err = b.Call(ctx, "progress", nil, func(p jobs.TransferProgress) error { seen = p.BytesDone == 50; return context.Canceled })
	if !seen || !errors.Is(err, context.Canceled) {
		t.Fatalf("progress/cancel: %v, %v", seen, err)
	}
	if _, err := b.Call(ctx, "crash", nil, nil); err == nil {
		t.Fatal("crash did not fail request")
	}
	if _, err := b.Call(ctx, "status", nil, nil); err != nil {
		t.Fatalf("could not restart: %v", err)
	}
}
