package details

import (
	"context"
	"crypto/sha1"
	"fmt"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func fixture(t *testing.T) (Service, string) {
	t.Helper()
	dir := t.TempDir()
	db, e := storage.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	return Service{Roots: roots.NewResolver([]roots.Root{{ID: "a", Path: dir}}), DB: db}, dir
}
func write(t *testing.T, path, content string) {
	t.Helper()
	if e := os.WriteFile(path, []byte(content), 0600); e != nil {
		t.Fatal(e)
	}
}
func TestHashAndCachedBasic(t *testing.T) {
	s, dir := fixture(t)
	path := filepath.Join(dir, "a.txt")
	write(t, path, "hello")
	req := Request{RootID: "a", Paths: []string{"a.txt"}}
	ctx := context.Background()
	basic, e := s.Basic(ctx, req)
	if e != nil || basic[0].Size != 5 || basic[0].SHA1 != "" {
		t.Fatalf("%+v %v", basic, e)
	}
	result, e := s.Hash(ctx, req)
	if e != nil {
		t.Fatal(e)
	}
	want := fmt.Sprintf("%X", sha1.Sum([]byte("hello")))
	if result["sha1"] != want {
		t.Fatalf("%v", result)
	}
	// Read exactly the same record used by the Python transfer cache.
	info, _ := os.Stat(path)
	h, e := s.hashRecord(path, info)
	if e != nil {
		t.Fatal(e)
	}
	cached, e := s.DB.Hash(ctx, h)
	if e != nil || cached != want {
		t.Fatalf("cache=%s err=%v", cached, e)
	}
	write(t, path, "other")
	newBasic, e := s.Basic(ctx, req)
	if e != nil || newBasic[0].SHA1 != "" {
		t.Fatalf("stale cache: %+v %v", newBasic, e)
	}
	result, e = s.Hash(ctx, req)
	if e != nil || result["sha1"] == want {
		t.Fatalf("forced hash: %v %v", result, e)
	}
}
func TestStatsDeduplicatesParentsAndAllocatedHardlinks(t *testing.T) {
	s, dir := fixture(t)
	os.Mkdir(filepath.Join(dir, "folder"), 0700)
	write(t, filepath.Join(dir, "folder/a"), "hello")
	if e := os.Link(filepath.Join(dir, "folder/a"), filepath.Join(dir, "folder/b")); e != nil {
		t.Fatal(e)
	}
	req := Request{RootID: "a", Paths: []string{"folder", "folder/a", "folder"}}
	got, e := s.Stats(context.Background(), req)
	if e != nil || got.Files != 2 || got.Folders != 1 || got.Size != 10 {
		t.Fatalf("%+v %v", got, e)
	}
	file, _ := os.Stat(filepath.Join(dir, "folder/a"))
	folder, _ := os.Stat(filepath.Join(dir, "folder"))
	want := *allocated(file) + *allocated(folder)
	if got.Allocated == nil || *got.Allocated != want {
		t.Fatalf("allocated %+v want %d", got, want)
	}
	got, e = s.Stats(context.Background(), Request{RootID: "a", Paths: []string{"folder"}})
	if e != nil || got.Folders != 0 {
		t.Fatalf("single directory: %+v %v", got, e)
	}
}
func TestStatsDoesNotFollowSymlinkEvenAsSelectedRoot(t *testing.T) {
	s, dir := fixture(t)
	outside := t.TempDir()
	write(t, filepath.Join(outside, "secret"), "secret")
	os.Symlink(outside, filepath.Join(dir, "link"))
	req := Request{RootID: "a", Paths: []string{"link"}}
	got, e := s.Stats(context.Background(), req)
	if e != nil || got.Files != 1 || got.Folders != 0 || got.Size != int64(len(outside)) {
		t.Fatalf("symlink: %+v %v", got, e)
	}
	if _, e = s.Hash(context.Background(), req); e == nil {
		t.Fatal("hashed symlink")
	}
}
func TestSparseFileAndCancellation(t *testing.T) {
	s, dir := fixture(t)
	f, e := os.Create(filepath.Join(dir, "sparse"))
	if e != nil {
		t.Fatal(e)
	}
	f.Truncate(1 << 30)
	f.Close()
	got, e := s.Basic(context.Background(), Request{RootID: "a", Paths: []string{"sparse"}})
	if e != nil || got[0].Size != 1<<30 || got[0].Allocated == nil || *got[0].Allocated >= got[0].Size {
		t.Fatalf("%+v %v", got, e)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, e = s.Hash(ctx, Request{RootID: "a", Paths: []string{"sparse"}}); e == nil {
		t.Fatal("ignored cancellation")
	}
	if _, e = s.Basic(context.Background(), Request{RootID: "a", Paths: []string{"../escape"}}); e == nil {
		t.Fatal("outside root accepted")
	}
	if got[0].Created != nil && *got[0].Created > time.Now().Unix() {
		t.Fatal("future birth time")
	}
}

func TestHashForSymlinkedConfiguredRoot(t *testing.T) {
	s, dir := fixture(t)
	alias := filepath.Join(t.TempDir(), "alias")
	if e := os.Symlink(dir, alias); e != nil {
		t.Fatal(e)
	}
	s.Roots = roots.NewResolver([]roots.Root{{ID: "a", Path: alias}})
	write(t, filepath.Join(dir, "a.txt"), "hello")
	result, e := s.Hash(context.Background(), Request{RootID: "a", Paths: []string{"a.txt"}})
	if e != nil || result["sha1"] != fmt.Sprintf("%X", sha1.Sum([]byte("hello"))) {
		t.Fatalf("%v %v", result, e)
	}
}
