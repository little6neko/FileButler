package storage_test

import (
	"context"
	"crypto/sha1"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/little6neko/filebutler/internal/details"
	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/ops"
	"github.com/little6neko/filebutler/internal/rename"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
)

func seedLocalHash(t *testing.T, db *storage.Store, resolver roots.Resolver, path, content string) string {
	t.Helper()
	info, err := storage.FreshLocalInfo(path)
	if err != nil {
		t.Fatal(err)
	}
	mapped, err := resolver.MapPath(path)
	if err != nil {
		t.Fatal(err)
	}
	digest := fmt.Sprintf("%X", sha1.Sum([]byte(content)))
	err = db.PutHash(context.Background(), storage.Hash{Scope: storage.LocalScope(mapped.Root.ID, mapped.Root.Path), Path: filepath.ToSlash(mapped.Rel), Version: storage.LocalVersion(info), SHA1: digest, Origin: "local"})
	if err != nil {
		t.Fatal(err)
	}
	return digest
}

func assertLocalHash(t *testing.T, db *storage.Store, resolver roots.Resolver, root, path, want string) {
	t.Helper()
	items, err := (details.Service{Roots: resolver, DB: db}).Basic(context.Background(), details.Request{RootID: root, Paths: []string{path}})
	if err != nil || len(items) != 1 {
		t.Fatalf("details: %+v %v", items, err)
	}
	if items[0].SHA1 != want {
		t.Fatalf("%s/%s hash=%q, want %q", root, path, items[0].SHA1, want)
	}
}

func TestCachedSHA1FollowsLocalFileAndDirectoryOperations(t *testing.T) {
	for _, action := range []string{"rename", "move", "copy", "cross-device-move"} {
		for _, directory := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/directory=%t", action, directory), func(t *testing.T) {
				ctx := context.Background()
				a, b := t.TempDir(), t.TempDir()
				if action == "cross-device-move" {
					var err error
					b, err = os.MkdirTemp("/dev/shm", "fb-hash-move-")
					if err != nil {
						t.Skip(err)
					}
					t.Cleanup(func() { os.RemoveAll(b) })
				}
				db, err := storage.Open(filepath.Join(t.TempDir(), "db.sqlite"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { db.Close() })
				resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: a}, {ID: "b", Path: b}})
				source, leaf, target := "source%_", "", "target"
				if directory {
					leaf = "nested/file.txt"
					if err := os.MkdirAll(filepath.Join(a, source, "nested"), 0700); err != nil {
						t.Fatal(err)
					}
				}
				original := filepath.Join(a, source, leaf)
				if err := os.WriteFile(original, []byte("data"), 0600); err != nil {
					t.Fatal(err)
				}
				want := seedLocalHash(t, db, resolver, original, "data")
				if directory {
					if err := os.WriteFile(filepath.Join(a, source, "uncached.txt"), []byte("other"), 0600); err != nil {
						t.Fatal(err)
					}
				}
				// Prefix lookalikes must not be relocated or invalidated.
				other := filepath.Join(a, "source-other.txt")
				if err := os.WriteFile(other, []byte("untouched"), 0600); err != nil {
					t.Fatal(err)
				}
				otherHash := seedLocalHash(t, db, resolver, other, "untouched")
				destRoot := "b"
				if action == "rename" {
					destRoot = "a"
					// Renaming cached files must not try to open/read their contents.
					if err := os.Chmod(original, 0000); err != nil {
						t.Fatal(err)
					}
					want = seedLocalHash(t, db, resolver, original, "data")
					err = (rename.Executor{Resolver: resolver, Cache: db}).ExecuteItem(ctx, jobs.ExecutableItem{SourceRoot: "a", SourcePath: source, DestRoot: "a", DestPath: target})
				} else {
					op := ops.OpMove
					if action == "copy" {
						op = ops.OpCopy
					}
					err = (ops.Executor{Resolver: resolver, Cache: db}).Execute(ctx, ops.PlanItem{Operation: op, SourceRoot: "a", SourcePath: source, DestRoot: "b", DestPath: target})
				}
				if err != nil {
					t.Fatal(err)
				}
				assertLocalHash(t, db, resolver, destRoot, filepath.Join(target, leaf), want)
				assertLocalHash(t, db, resolver, "a", "source-other.txt", otherHash)
				if directory {
					assertLocalHash(t, db, resolver, destRoot, target+"/uncached.txt", "")
				}
				if action == "copy" {
					assertLocalHash(t, db, resolver, "a", filepath.Join(source, leaf), want)
				}
				var stale int
				if err := db.DB.QueryRow(`SELECT count(*) FROM file_hashes WHERE path LIKE '.filebutler-move-%'`).Scan(&stale); err != nil || stale != 0 {
					t.Fatalf("staging hashes=%d err=%v", stale, err)
				}
			})
		}
	}
}

func TestFailedRenamePreservesSourceHashAndDoesNotClaimDestination(t *testing.T) {
	dir := t.TempDir()
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})
	source, destination := filepath.Join(dir, "a"), filepath.Join(dir, "b")
	if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	digest := seedLocalHash(t, db, resolver, source, "data")
	injected := errors.New("rename failed")
	if err := db.RenameLocal(context.Background(), resolver, source, destination, func(string, string) error { return injected }); !errors.Is(err, injected) {
		t.Fatal(err)
	}
	assertLocalHash(t, db, resolver, "a", "a", digest)
}

func TestChangedContentDoesNotInheritOldHashDuringCopyOrRename(t *testing.T) {
	for _, action := range []string{"rename", "copy"} {
		t.Run(action, func(t *testing.T) {
			dir := t.TempDir()
			db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})
			source := filepath.Join(dir, "a")
			if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
				t.Fatal(err)
			}
			seedLocalHash(t, db, resolver, source, "data")
			before, _ := os.Stat(source)
			if err := os.WriteFile(source, []byte("EDIT"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(source, before.ModTime(), before.ModTime()); err != nil {
				t.Fatal(err)
			}
			if action == "rename" {
				err = db.RenameLocal(context.Background(), resolver, source, filepath.Join(dir, "b"), os.Rename)
			} else {
				err = (ops.Executor{Resolver: resolver, Cache: db}).Execute(context.Background(), ops.PlanItem{Operation: ops.OpCopy, SourceRoot: "a", SourcePath: "a", DestRoot: "a", DestPath: "b"})
			}
			if err != nil {
				t.Fatal(err)
			}
			assertLocalHash(t, db, resolver, "a", "b", "")
		})
	}
}

func TestLocalCacheFollowsRenameOnMergerFS(t *testing.T) {
	mount, backing := os.Getenv("FILEBUTLER_TEST_FUSE_ROOT"), os.Getenv("FILEBUTLER_TEST_FUSE_BACKING")
	if mount == "" || backing == "" {
		t.Skip("temporary mergerfs mount required")
	}
	dir, err := os.MkdirTemp(mount, "hash-rename-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})
	source, dest := filepath.Join(dir, "source"), filepath.Join(dir, "dest")
	if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	digest := seedLocalHash(t, db, resolver, source, "data")
	if err := db.RenameLocal(context.Background(), resolver, source, dest, os.Rename); err != nil {
		t.Fatal(err)
	}
	assertLocalHash(t, db, resolver, "a", "dest", digest)
	rel, _ := filepath.Rel(mount, dest)
	actual, err := os.Stat(filepath.Join(backing, rel))
	if err != nil {
		t.Fatal(err)
	}
	visible, err := storage.FreshLocalInfo(dest)
	if err != nil {
		t.Fatal(err)
	}
	if actual.Sys().(*syscall.Stat_t).Ctim != visible.Sys().(*syscall.Stat_t).Ctim {
		t.Fatal("ctime did not reflect backing filesystem")
	}
}

func TestCachedSHA1FollowsMovesOnMergerFS(t *testing.T) {
	mount := os.Getenv("FILEBUTLER_TEST_FUSE_ROOT")
	if mount == "" {
		t.Skip("temporary mergerfs mount required")
	}
	for _, direction := range []string{"same-filesystem", "into-mergerfs", "out-of-mergerfs"} {
		for _, directory := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/directory=%t", direction, directory), func(t *testing.T) {
				fuseDir, err := os.MkdirTemp(mount, "move-hash-")
				if err != nil {
					t.Fatal(err)
				}
				defer os.RemoveAll(fuseDir)
				a, b := fuseDir, fuseDir
				if direction != "same-filesystem" {
					other, err := os.MkdirTemp("/dev/shm", "fb-mergerfs-move-")
					if err != nil {
						t.Skip(err)
					}
					defer os.RemoveAll(other)
					if direction == "into-mergerfs" {
						a = other
					} else {
						b = other
					}
				}
				db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
				if err != nil {
					t.Fatal(err)
				}
				defer db.Close()
				resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: a}, {ID: "b", Path: b}})
				destRoot := "b"
				if a == b {
					resolver = roots.NewResolver([]roots.Root{{ID: "a", Path: a}})
					destRoot = "a"
				}
				leaf := ""
				if directory {
					leaf = "nested/file.txt"
					if err := os.MkdirAll(filepath.Join(a, "source", "nested"), 0700); err != nil {
						t.Fatal(err)
					}
				}
				source := filepath.Join(a, "source", leaf)
				if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
					t.Fatal(err)
				}
				// A same-filesystem move must not read the file to copy or hash it.
				if a == b {
					if err := os.Chmod(source, 0000); err != nil {
						t.Fatal(err)
					}
				}
				digest := seedLocalHash(t, db, resolver, source, "data")
				before, err := storage.FreshLocalInfo(source)
				if err != nil {
					t.Fatal(err)
				}
				err = (ops.Executor{Resolver: resolver, Cache: db}).Execute(context.Background(), ops.PlanItem{
					Operation: ops.OpMove, SourceRoot: "a", SourcePath: "source", DestRoot: destRoot, DestPath: "dest",
				})
				if err != nil {
					t.Fatal(err)
				}
				assertLocalHash(t, db, resolver, destRoot, filepath.Join("dest", leaf), digest)
				if _, err := os.Lstat(filepath.Join(a, "source")); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("source remains: %v", err)
				}
				after, err := storage.FreshLocalInfo(filepath.Join(b, "dest", leaf))
				if err != nil {
					t.Fatal(err)
				}
				if a == b && !os.SameFile(before, after) {
					t.Fatal("same-filesystem move copied the file")
				}
				if a != b {
					body, err := os.ReadFile(filepath.Join(b, "dest", leaf))
					if err != nil || string(body) != "data" {
						t.Fatalf("destination data=%q err=%v", body, err)
					}
				}
				var stale int
				if err := db.DB.QueryRow(`SELECT count(*) FROM file_hashes WHERE path LIKE '.filebutler-move-%' OR path='source' OR path LIKE 'source/%'`).Scan(&stale); err != nil || stale != 0 {
					t.Fatalf("stale source/staging hashes=%d err=%v", stale, err)
				}
			})
		}
	}
}

func TestReplacementDuringRenameCannotInheritOriginalDigest(t *testing.T) {
	dir := t.TempDir()
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})
	source, destination, replacement := filepath.Join(dir, "a"), filepath.Join(dir, "b"), filepath.Join(dir, "replacement")
	if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	seedLocalHash(t, db, resolver, source, "data")
	info, _ := os.Stat(source)
	if err := os.WriteFile(replacement, []byte("EDIT"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(replacement, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	err = db.RenameLocal(context.Background(), resolver, source, destination, func(src, dst string) error {
		if err := os.Rename(replacement, src); err != nil {
			return err
		}
		return os.Rename(src, dst)
	})
	if err != nil {
		t.Fatal(err)
	}
	assertLocalHash(t, db, resolver, "a", "b", "")
}

func TestUnavailableCacheDoesNotFailSuccessfulRename(t *testing.T) {
	dir := t.TempDir()
	db, err := storage.Open(filepath.Join(t.TempDir(), "db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	resolver := roots.NewResolver([]roots.Root{{ID: "a", Path: dir}})
	source, destination := filepath.Join(dir, "a"), filepath.Join(dir, "b")
	if err := os.WriteFile(source, []byte("data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.RenameLocal(context.Background(), resolver, source, destination, os.Rename); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(destination); err != nil {
		t.Fatal(err)
	}
}
