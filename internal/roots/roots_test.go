package roots

import (
	"errors"
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
