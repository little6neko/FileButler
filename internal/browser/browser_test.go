package browser

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestListDirectoryReturnsNaturalSortedEntries(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"file100.txt", "file10.txt", "file02.txt", "file2.txt", "file1.txt"} {
		testutil.WriteFile(t, filepath.Join(root, name), "x")
	}
	svc := Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}

	entries, err := svc.List(context.Background(), "data", ".")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	got := make([]string, len(entries))
	for i, entry := range entries {
		got[i] = entry.Name
	}
	want := []string{"file1.txt", "file2.txt", "file02.txt", "file10.txt", "file100.txt"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("entry[%d] = %q, want %q; all=%v", i, got[i], want[i], got)
		}
	}
}

func TestListDirectoryIncludesSymlinkMetadata(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "target.txt"), "x")
	if err := os.Symlink("target.txt", filepath.Join(root, "link.txt")); err != nil {
		t.Fatal(err)
	}
	svc := Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}

	entries, err := svc.List(context.Background(), "data", ".")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	var link Entry
	for _, entry := range entries {
		if entry.Name == "link.txt" {
			link = entry
			break
		}
	}
	if !link.IsSymlink || link.SymlinkTarget != "target.txt" || link.Type != "symlink" {
		t.Fatalf("unexpected link metadata: %+v", link)
	}
}

func TestListDirectoryRejectsFilePath(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "file.txt"), "x")
	svc := Service{Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}})}

	_, err := svc.List(context.Background(), "data", "file.txt")
	if !errors.Is(err, ErrNotDirectory) {
		t.Fatalf("err = %v, want not directory", err)
	}
}
