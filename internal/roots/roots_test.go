package roots

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveAllowsRelativePathInsideRoot(t *testing.T) {
	dir := t.TempDir()
	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: dir}})

	got, err := resolver.Resolve("data", "folder/file.txt")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got.Rel != "folder/file.txt" {
		t.Fatalf("rel = %q", got.Rel)
	}
	if got.Abs != filepath.Join(dir, "folder", "file.txt") {
		t.Fatalf("abs = %q", got.Abs)
	}
}

func TestResolveRejectsDotDotEscape(t *testing.T) {
	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: t.TempDir()}})
	if _, err := resolver.Resolve("data", "../outside"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("err = %v, want outside root", err)
	}
}

func TestResolveRejectsAbsoluteRelativePath(t *testing.T) {
	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: t.TempDir()}})
	if _, err := resolver.Resolve("data", "/tmp/file"); !errors.Is(err, ErrInvalidPath) {
		t.Fatalf("err = %v, want invalid path", err)
	}
}

func TestResolveForWriteRejectsSymlinkEscape(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "root")
	outside := filepath.Join(base, "outside")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "target.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link-out")); err != nil {
		t.Fatal(err)
	}

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	if _, err := resolver.ResolveForWrite("data", "link-out/target.txt"); !errors.Is(err, ErrOutsideRoot) {
		t.Fatalf("err = %v, want outside root", err)
	}
}

func TestResolveForWriteAllowsSymlinkInsideRoot(t *testing.T) {
	root := t.TempDir()
	targetDir := filepath.Join(root, "target")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(targetDir, filepath.Join(root, "link-in")); err != nil {
		t.Fatal(err)
	}

	resolver := NewResolver([]Root{{ID: "data", Name: "Data", Path: root}})
	got, err := resolver.ResolveForWrite("data", "link-in/new.txt")
	if err != nil {
		t.Fatalf("ResolveForWrite: %v", err)
	}
	if got.Abs != filepath.Join(root, "link-in", "new.txt") {
		t.Fatalf("abs = %q", got.Abs)
	}
}
