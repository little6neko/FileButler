package ops

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/little6neko/filebutler/internal/jobs"
)

func crossDevice(string, string) error { return syscall.EXDEV }

func TestCrossDeviceMoveCopiesTreeAndLinksThenDeletes(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source")
	dest := filepath.Join(dir, "dest")
	if err := os.Mkdir(src, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(src, "a"), []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("a", filepath.Join(src, "link")); err != nil {
		t.Skip(err)
	}
	if err := movePath(context.Background(), src, dest, crossDevice); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("source survived")
	}
	assertContent(t, filepath.Join(dest, "a"), "data")
	if target, _ := os.Readlink(filepath.Join(dest, "link")); target != "a" {
		t.Fatal("link was followed")
	}
}

func TestCrossDeviceMovePreservesSourceOnFailure(t *testing.T) {
	for _, reason := range []string{"cancel", "changed", "target", "permission"} {
		t.Run(reason, func(t *testing.T) {
			dir := t.TempDir()
			src, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
			os.WriteFile(src, []byte("data"), 0600)
			rename := crossDevice
			if reason == "permission" {
				rename = func(string, string) error { return os.ErrPermission }
			}
			if reason == "target" {
				os.WriteFile(dest, []byte("existing"), 0600)
			}
			ctx := jobs.WithReporter(context.Background(), func(p jobs.TransferProgress) error {
				if p.BytesDone > 0 {
					if reason == "cancel" {
						return context.Canceled
					}
					if reason == "changed" {
						return os.WriteFile(src, []byte("changed"), 0600)
					}
				}
				return nil
			})
			if err := movePath(ctx, src, dest, rename); err == nil {
				t.Fatal("expected failure")
			}
			if _, err := os.Stat(src); err != nil {
				t.Fatal("lost source", err)
			}
			if reason == "target" {
				assertContent(t, dest, "existing")
			} else if _, err := os.Stat(dest); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("partial destination survived")
			}
		})
	}
}

func TestRealCrossFilesystemMove(t *testing.T) {
	other, err := os.MkdirTemp("/dev/shm", "filebutler-move-test-")
	if err != nil {
		t.Skip(err)
	}
	defer os.RemoveAll(other)
	src := filepath.Join(t.TempDir(), "file")
	dest := filepath.Join(other, "file")
	if err := os.WriteFile(src, []byte("cross filesystem"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := movePath(context.Background(), src, dest, nil); err != nil {
		t.Fatal(err)
	}
	assertContent(t, dest, "cross filesystem")
	if _, err := os.Stat(src); !os.IsNotExist(err) {
		t.Fatal("source not removed")
	}
}
