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
	if link.SymlinkResolution == nil || link.SymlinkResolution.State != SymlinkMapped ||
		link.SymlinkResolution.TargetKind != "file" || link.SymlinkResolution.TargetRootID != "data" ||
		link.SymlinkResolution.TargetPath != "target.txt" {
		t.Fatalf("unexpected link resolution: %+v", link.SymlinkResolution)
	}
}

func TestListDirectoryClassifiesMappedUnmappedAndBrokenSymlinks(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	nested := filepath.Join(root, "nested")
	other := filepath.Join(base, "other")
	outside := filepath.Join(base, "outside")
	for _, directory := range []string{nested, other, outside} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	testutil.WriteFile(t, filepath.Join(nested, "mapped.txt"), "mapped")
	if err := os.Mkdir(filepath.Join(other, "映射目录"), 0o755); err != nil {
		t.Fatal(err)
	}
	testutil.WriteFile(t, filepath.Join(outside, "secret.txt"), "secret")
	links := map[string]string{
		"mapped-file": filepath.Join(nested, "mapped.txt"),
		"mapped-dir":  filepath.Join(other, "映射目录"),
		"unmapped":    filepath.Join(outside, "secret.txt"),
		"broken":      filepath.Join(root, "missing.txt"),
		"loop":        "loop",
	}
	for name, target := range links {
		if err := os.Symlink(target, filepath.Join(root, name)); err != nil {
			t.Fatal(err)
		}
	}

	svc := Service{Resolver: roots.NewResolver([]roots.Root{
		{ID: "root", Name: "Root", Path: root},
		{ID: "nested", Name: "Nested", Path: nested},
		{ID: "other", Name: "Other", Path: other},
	})}
	entries, err := svc.List(context.Background(), "root", ".")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	byName := make(map[string]Entry, len(entries))
	for _, entry := range entries {
		byName[entry.Name] = entry
	}

	assertResolution(t, byName["mapped-file"], SymlinkResolution{
		State: SymlinkMapped, TargetKind: "file", TargetRootID: "nested", TargetPath: "mapped.txt",
	})
	assertResolution(t, byName["mapped-dir"], SymlinkResolution{
		State: SymlinkMapped, TargetKind: "directory", TargetRootID: "other", TargetPath: "映射目录",
	})
	assertResolution(t, byName["unmapped"], SymlinkResolution{State: SymlinkUnmapped})
	assertResolution(t, byName["broken"], SymlinkResolution{State: SymlinkBroken})
	assertResolution(t, byName["loop"], SymlinkResolution{State: SymlinkBroken})
}

func TestListDirectoryFollowsMappedDirectorySymlink(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	other := filepath.Join(base, "other")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	testutil.WriteFile(t, filepath.Join(other, "文件.txt"), "x")
	if err := os.Symlink(other, filepath.Join(root, "入口")); err != nil {
		t.Fatal(err)
	}
	svc := Service{Resolver: roots.NewResolver([]roots.Root{
		{ID: "root", Name: "Root", Path: root},
		{ID: "other", Name: "Other", Path: other},
	})}

	entries, err := svc.List(context.Background(), "root", "入口")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(entries) != 1 || entries[0].RelativePath != "入口/文件.txt" {
		t.Fatalf("entries = %+v", entries)
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

func TestListDirectoryUsesNarrowMaintainerToHideInternalEntries(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "visible.txt"), "visible")
	testutil.WriteFile(t, filepath.Join(root, ".internal", "payload"), "internal")
	maintainer := &recordingDirectoryMaintainer{hidden: map[string]struct{}{`.internal`: {}}}
	svc := Service{
		Resolver:   roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}}),
		Maintainer: maintainer,
	}

	entries, err := svc.List(context.Background(), "data", ".")
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].Name != "visible.txt" || maintainer.directory != root {
		t.Fatalf("entries = %+v, maintained = %q", entries, maintainer.directory)
	}
}

func TestListDirectoryReturnsMaintainerError(t *testing.T) {
	root := t.TempDir()
	want := errors.New("maintenance failed")
	svc := Service{
		Resolver: roots.NewResolver([]roots.Root{{ID: "data", Name: "Data", Path: root}}),
		Maintainer: &recordingDirectoryMaintainer{
			hidden: map[string]struct{}{`.internal`: {}}, err: want,
		},
	}
	if _, err := svc.List(context.Background(), "data", "."); !errors.Is(err, want) {
		t.Fatalf("err = %v, want %v", err, want)
	}
}

type recordingDirectoryMaintainer struct {
	hidden    map[string]struct{}
	err       error
	directory string
}

func (maintainer *recordingDirectoryMaintainer) Maintain(_ context.Context, directory string) (map[string]struct{}, error) {
	maintainer.directory = directory
	return maintainer.hidden, maintainer.err
}

func assertResolution(t *testing.T, entry Entry, want SymlinkResolution) {
	t.Helper()
	if entry.SymlinkResolution == nil || *entry.SymlinkResolution != want {
		t.Fatalf("%s resolution = %+v, want %+v", entry.Name, entry.SymlinkResolution, want)
	}
}
