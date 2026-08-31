package roots

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestResolveFollowReturnsRequestedAndActualMappedLocations(t *testing.T) {
	base := t.TempDir()
	rootA := filepath.Join(base, "root-a")
	rootB := filepath.Join(base, "root-b")
	mustMkdirAll(t, filepath.Join(rootA, "入口"))
	mustMkdirAll(t, filepath.Join(rootB, "目标(一)"))
	mustWriteFile(t, filepath.Join(rootB, "目标(一)", "file.txt"))
	mustSymlink(t, filepath.Join(rootB, "目标(一)"), filepath.Join(rootA, "入口", "跨根"))

	resolver := NewResolver([]Root{
		{ID: "a", Name: "A", Path: rootA},
		{ID: "b", Name: "B", Path: rootB},
	})
	got, err := resolver.ResolveFollow("a", "入口/跨根/file.txt")
	if err != nil {
		t.Fatalf("ResolveFollow: %v", err)
	}
	if got.Requested.Root.ID != "a" || got.Requested.Rel != filepath.Join("入口", "跨根", "file.txt") {
		t.Fatalf("requested = %#v", got.Requested)
	}
	if got.Actual.Root.ID != "b" || got.Actual.Rel != filepath.Join("目标(一)", "file.txt") {
		t.Fatalf("actual = %#v", got.Actual)
	}
	if got.Actual.Abs != filepath.Join(rootB, "目标(一)", "file.txt") {
		t.Fatalf("actual abs = %q", got.Actual.Abs)
	}
}

func TestResolveFollowSupportsRelativeAbsoluteAndChainedSymlinks(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "real", "deep"))
	mustWriteFile(t, filepath.Join(root, "real", "deep", "target.txt"))
	mustSymlink(t, filepath.Join(root, "real", "deep"), filepath.Join(root, "absolute"))
	mustSymlink(t, "absolute", filepath.Join(root, "chain"))
	mustSymlink(t, filepath.Join("..", "real"), filepath.Join(root, "links", "relative"))

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	for _, rel := range []string{
		filepath.Join("absolute", "target.txt"),
		filepath.Join("chain", "target.txt"),
		filepath.Join("links", "relative", "deep", "target.txt"),
	} {
		got, err := resolver.ResolveFollow("data", rel)
		if err != nil {
			t.Fatalf("ResolveFollow(%q): %v", rel, err)
		}
		if got.Actual.Rel != filepath.Join("real", "deep", "target.txt") {
			t.Fatalf("ResolveFollow(%q) actual rel = %q", rel, got.Actual.Rel)
		}
	}
}

func TestResolveFollowAcceptsAbsoluteTargetThroughConfiguredRootAlias(t *testing.T) {
	base := t.TempDir()
	realRoot := filepath.Join(base, "real")
	aliasRoot := filepath.Join(base, "alias")
	mustMkdirAll(t, filepath.Join(realRoot, "target"))
	mustWriteFile(t, filepath.Join(realRoot, "target", "file.txt"))
	mustSymlink(t, realRoot, aliasRoot)
	mustSymlink(t, filepath.Join(aliasRoot, "target"), filepath.Join(realRoot, "link"))

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: aliasRoot}})
	got, err := resolver.ResolveFollow("data", "link/file.txt")
	if err != nil {
		t.Fatalf("ResolveFollow: %v", err)
	}
	if got.Actual.Abs != filepath.Join(realRoot, "target", "file.txt") {
		t.Fatalf("actual abs = %q", got.Actual.Abs)
	}
}

func TestResolveFollowClassifiesMissingLoopAndOutsideRoot(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	mustMkdirAll(t, root)
	mustMkdirAll(t, outside)
	mustWriteFile(t, filepath.Join(outside, "secret.txt"))
	mustSymlink(t, "missing.txt", filepath.Join(root, "broken"))
	mustSymlink(t, "loop-b", filepath.Join(root, "loop-a"))
	mustSymlink(t, "loop-a", filepath.Join(root, "loop-b"))
	mustSymlink(t, filepath.Join(outside, "secret.txt"), filepath.Join(root, "outside"))

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	if _, err := resolver.ResolveFollow("data", "broken"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("broken err = %v, want not exist", err)
	}
	if _, err := resolver.ResolveFollow("data", "loop-a"); !errors.Is(err, ErrSymlinkLoop) {
		t.Fatalf("loop err = %v, want symlink loop", err)
	}
	if _, err := resolver.ResolveFollow("data", "outside"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("outside err = %v, want outside root", err)
	}
}

func TestResolveFollowStopsBeforeProbingOutsideMappedRoots(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	mustMkdirAll(t, root)
	mustMkdirAll(t, outside)
	mustWriteFile(t, filepath.Join(outside, "secret.txt"))
	mustSymlink(t, filepath.Join(outside, "secret.txt"), filepath.Join(root, "link"))

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	var probed []string
	originalLstat := resolver.lstat
	resolver.lstat = func(path string) (os.FileInfo, error) {
		probed = append(probed, filepath.Clean(path))
		return originalLstat(path)
	}

	if _, err := resolver.ResolveFollow("data", "link"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("err = %v, want outside root", err)
	}
	if slices.Contains(probed, filepath.Join(outside, "secret.txt")) {
		t.Fatalf("resolver probed an unmapped target: %v", probed)
	}
}

func TestResolveEntryFollowsParentButNotFinalSymlink(t *testing.T) {
	base := t.TempDir()
	rootA := filepath.Join(base, "a")
	rootB := filepath.Join(base, "b")
	mustMkdirAll(t, filepath.Join(rootA, "real-parent"))
	mustMkdirAll(t, rootB)
	mustWriteFile(t, filepath.Join(rootB, "target.txt"))
	mustSymlink(t, "real-parent", filepath.Join(rootA, "parent"))
	mustSymlink(t, filepath.Join(rootB, "target.txt"), filepath.Join(rootA, "real-parent", "entry"))

	resolver := NewResolver([]Root{
		{ID: "a", Name: "A", Path: rootA},
		{ID: "b", Name: "B", Path: rootB},
	})
	got, err := resolver.ResolveEntry("a", "parent/entry")
	if err != nil {
		t.Fatalf("ResolveEntry: %v", err)
	}
	if got.Actual.Root.ID != "a" || got.Actual.Rel != filepath.Join("real-parent", "entry") {
		t.Fatalf("actual = %#v", got.Actual)
	}
	info, err := os.Lstat(got.Actual.Abs)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("entry was unexpectedly followed: mode = %v", info.Mode())
	}
}

func TestResolveEntryRequiresExistingFinalEntry(t *testing.T) {
	root := t.TempDir()
	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	if _, err := resolver.ResolveEntry("data", "missing.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v, want not exist", err)
	}
}

func TestResolveCreateRequiresExistingDirectoryParentAndUnusedName(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "real"))
	mustSymlink(t, "real", filepath.Join(root, "parent"))
	mustWriteFile(t, filepath.Join(root, "real", "occupied.txt"))
	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})

	got, err := resolver.ResolveCreate("data", "parent/new.txt")
	if err != nil {
		t.Fatalf("ResolveCreate: %v", err)
	}
	if got.Actual.Rel != filepath.Join("real", "new.txt") {
		t.Fatalf("actual rel = %q", got.Actual.Rel)
	}
	if _, err := resolver.ResolveCreate("data", "parent/occupied.txt"); !errors.Is(err, ErrPathExists) {
		t.Fatalf("occupied err = %v, want path exists", err)
	}
	if _, err := resolver.ResolveCreate("data", "missing/new.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing parent err = %v, want not exist", err)
	}
	if _, err := resolver.ResolveCreate("data", "."); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("root create err = %v, want invalid path", err)
	}
}

func TestMapPathUsesMostSpecificCanonicalRootAndStableID(t *testing.T) {
	base := t.TempDir()
	shared := filepath.Join(base, "shared")
	nested := filepath.Join(shared, "nested")
	mustMkdirAll(t, nested)
	alias := filepath.Join(base, "alias")
	mustSymlink(t, shared, alias)

	resolver := NewResolver([]Root{
		{ID: "z-alias", Name: "Alias", Path: alias},
		{ID: "a-shared", Name: "Shared", Path: shared},
		{ID: "nested", Name: "Nested", Path: nested},
	})
	sharedLocation, err := resolver.MapPath(filepath.Join(shared, "file.txt"))
	if err != nil {
		t.Fatalf("MapPath(shared): %v", err)
	}
	if sharedLocation.Root.ID != "a-shared" || sharedLocation.Rel != "file.txt" {
		t.Fatalf("shared location = %#v", sharedLocation)
	}
	nestedLocation, err := resolver.MapPath(filepath.Join(nested, "child.txt"))
	if err != nil {
		t.Fatalf("MapPath(nested): %v", err)
	}
	if nestedLocation.Root.ID != "nested" || nestedLocation.Rel != "child.txt" {
		t.Fatalf("nested location = %#v", nestedLocation)
	}
	if _, err := resolver.MapPath(base); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("outside err = %v, want outside root", err)
	}
}

func TestMapPathRejectsRelativePath(t *testing.T) {
	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: t.TempDir()}})
	if _, err := resolver.MapPath("relative/file.txt"); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("err = %v, want invalid path", err)
	}
}

func TestResolveFollowCanonicalizesConfiguredRootSymlink(t *testing.T) {
	base := t.TempDir()
	realRoot := filepath.Join(base, "real")
	aliasRoot := filepath.Join(base, "alias")
	mustMkdirAll(t, realRoot)
	mustWriteFile(t, filepath.Join(realRoot, "file.txt"))
	mustSymlink(t, realRoot, aliasRoot)

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: aliasRoot}})
	got, err := resolver.ResolveFollow("data", "file.txt")
	if err != nil {
		t.Fatalf("ResolveFollow: %v", err)
	}
	if got.Requested.Abs != filepath.Join(aliasRoot, "file.txt") {
		t.Fatalf("requested abs = %q", got.Requested.Abs)
	}
	if got.Actual.Abs != filepath.Join(realRoot, "file.txt") {
		t.Fatalf("actual abs = %q", got.Actual.Abs)
	}
}

func TestResolveFollowAllowsLexicallyNormalizedTargetInsideRoot(t *testing.T) {
	root := t.TempDir()
	mustMkdirAll(t, filepath.Join(root, "one"))
	mustMkdirAll(t, filepath.Join(root, "two"))
	mustWriteFile(t, filepath.Join(root, "two", "target.txt"))
	mustSymlink(t, filepath.Join("..", "two"), filepath.Join(root, "one", "link"))

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	got, err := resolver.ResolveFollow("data", "one/link/target.txt")
	if err != nil {
		t.Fatalf("ResolveFollow: %v", err)
	}
	if got.Actual.Rel != filepath.Join("two", "target.txt") {
		t.Fatalf("actual rel = %q", got.Actual.Rel)
	}
}

func mustMkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func mustWriteFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("test"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustSymlink(t *testing.T, target string, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
}
