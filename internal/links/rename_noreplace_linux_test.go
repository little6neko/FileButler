//go:build linux || android

package links

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"golang.org/x/sys/unix"
)

func TestRenameNoReplaceUnsupportedFallback(t *testing.T) {
	for _, unsupported := range []error{unix.EINVAL, unix.ENOSYS, unix.EOPNOTSUPP} {
		for _, kind := range []string{"file", "directory", "symlink"} {
			t.Run(fmt.Sprintf("%s/%s", unsupported, kind), func(t *testing.T) {
				dir := t.TempDir()
				source, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
				makeRenameFixture(t, source, kind)
				before, err := os.Lstat(source)
				if err != nil {
					t.Fatal(err)
				}
				if err := renameNoReplaceWith(source, dest, func(string, string) error { return unsupported }); err != nil {
					t.Fatal(err)
				}
				after, err := os.Lstat(dest)
				if err != nil || !os.SameFile(before, after) {
					t.Fatalf("move must retain inode: %v", err)
				}
				if _, err := os.Lstat(source); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("source remains: %v", err)
				}
			})
		}
	}
}

func TestRenameNoReplaceFallbackRejectsExistingTargets(t *testing.T) {
	for _, kind := range []string{"file", "directory", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			source, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
			makeRenameFixture(t, source, kind)
			makeRenameFixture(t, dest, kind)
			before, err := os.Lstat(dest)
			if err != nil {
				t.Fatal(err)
			}
			err = renameNoReplaceWith(source, dest, func(string, string) error { return unix.EINVAL })
			if !errors.Is(err, os.ErrExist) {
				t.Fatalf("want conflict, got %v", err)
			}
			after, err := os.Lstat(dest)
			if err != nil || !os.SameFile(before, after) {
				t.Fatalf("target changed: %v", err)
			}
			if _, err := os.Lstat(source); err != nil {
				t.Fatalf("source lost: %v", err)
			}
		})
	}
}

func TestRenameNoReplaceDoesNotMaskOtherErrors(t *testing.T) {
	for _, cause := range []error{unix.EXDEV, unix.EACCES, unix.EPERM, unix.ENOENT, unix.EEXIST, unix.ENOTEMPTY, unix.EIO} {
		t.Run(cause.Error(), func(t *testing.T) {
			dir := t.TempDir()
			source, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
			makeRenameFixture(t, source, "file")
			err := renameNoReplaceWith(source, dest, func(string, string) error { return cause })
			if !errors.Is(err, cause) {
				t.Fatalf("want %v, got %v", cause, err)
			}
			if _, err := os.Lstat(source); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(dest); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("unexpected destination: %v", err)
			}
		})
	}
}

func TestRenameNoReplaceFallbackConcurrentTarget(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "dest")
	const count = 20
	for i := range count {
		makeRenameFixture(t, filepath.Join(dir, fmt.Sprint(i)), "file")
	}
	start := make(chan struct{})
	results := make(chan error, count)
	var wg sync.WaitGroup
	for i := range count {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- renameNoReplaceWith(filepath.Join(dir, fmt.Sprint(i)), dest, func(string, string) error { return unix.EINVAL })
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		} else if !errors.Is(err, os.ErrExist) {
			t.Fatal(err)
		}
	}
	if winners != 1 {
		t.Fatalf("successful moves=%d, want 1", winners)
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != count {
		t.Fatalf("lost sources: entries=%d err=%v", len(entries), err)
	}
}

func TestRenameNoReplaceFallbackKeepsInvalidMoveInvalid(t *testing.T) {
	source := filepath.Join(t.TempDir(), "source")
	makeRenameFixture(t, source, "directory")
	err := renameNoReplaceWith(source, filepath.Join(source, "child"), func(string, string) error { return unix.EINVAL })
	if !errors.Is(err, unix.EINVAL) {
		t.Fatalf("move into itself: %v", err)
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal(err)
	}
}

func makeRenameFixture(t *testing.T, path, kind string) {
	t.Helper()
	var err error
	switch kind {
	case "directory":
		err = os.Mkdir(path, 0700)
	case "symlink":
		err = os.Symlink("missing-target", path)
	default:
		err = os.WriteFile(path, []byte("keep me"), 0600)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func TestRenameNoReplaceMergerFS(t *testing.T) {
	mount := os.Getenv("FILEBUTLER_TEST_FUSE_ROOT")
	if mount == "" {
		t.Skip("temporary mergerfs mount required")
	}
	for _, kind := range []string{"file", "directory", "symlink"} {
		t.Run(kind, func(t *testing.T) {
			dir, err := os.MkdirTemp(mount, "rename-fallback-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(dir)
			source, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
			makeRenameFixture(t, source, kind)
			makeRenameFixture(t, dest, kind)
			err = RenameNoReplace(source, dest)
			if !errors.Is(err, os.ErrExist) {
				t.Fatalf("existing target: %v", err)
			}
			if err := os.Remove(dest); err != nil {
				t.Fatal(err)
			}
			if err := RenameNoReplace(source, dest); err != nil {
				t.Fatal(err)
			}
			if _, err := os.Lstat(source); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("source: %v", err)
			}
			if _, err := os.Lstat(dest); err != nil {
				t.Fatal(err)
			}
		})
	}
}
