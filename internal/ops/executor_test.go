package ops

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/little6neko/filebutler/internal/testutil"
)

func TestExecutorCopiesFile(t *testing.T) {
	rootA, rootB, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "hello")
	item := PlanItem{Operation: OpCopy, SourceRoot: "a", SourcePath: "a.txt", DestRoot: "b", DestPath: "a.txt"}
	if err := executor.Execute(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	assertContent(t, filepath.Join(rootB, "a.txt"), "hello")
}

func TestExecutorMovesFile(t *testing.T) {
	rootA, rootB, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "hello")
	item := PlanItem{Operation: OpMove, SourceRoot: "a", SourcePath: "a.txt", DestRoot: "b", DestPath: "a.txt"}
	if err := executor.Execute(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootA, "a.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source still exists or unexpected err: %v", err)
	}
	assertContent(t, filepath.Join(rootB, "a.txt"), "hello")
}

func TestExecutorCreatesSymlink(t *testing.T) {
	rootA, rootB, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "hello")
	item := PlanItem{Operation: OpSymlink, SourceRoot: "a", SourcePath: "a.txt", DestRoot: "b", DestPath: "a.txt"}
	if err := executor.Execute(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	target, err := os.Readlink(filepath.Join(rootB, "a.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if target != filepath.Join(rootA, "a.txt") {
		t.Fatalf("target = %q", target)
	}
}

func TestExecutorCreatesHardLink(t *testing.T) {
	rootA, rootB, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "hello")
	item := PlanItem{Operation: OpHardlink, SourceRoot: "a", SourcePath: "a.txt", DestRoot: "b", DestPath: "a.txt"}
	if err := executor.Execute(context.Background(), item); err != nil {
		if runtime.GOOS == "windows" {
			t.Skip(err)
		}
		t.Fatal(err)
	}
	assertContent(t, filepath.Join(rootB, "a.txt"), "hello")
}

func TestExecutorDeletesFile(t *testing.T) {
	rootA, _, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "hello")
	item := PlanItem{Operation: OpDelete, SourceRoot: "a", SourcePath: "a.txt"}
	if err := executor.Execute(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootA, "a.txt")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file exists or unexpected err: %v", err)
	}
}

func TestExecutorCopiesDirectoryRecursively(t *testing.T) {
	rootA, rootB, executor := executorFixture(t)
	testutil.WriteFile(t, filepath.Join(rootA, "dir", "child.txt"), "hello")
	item := PlanItem{Operation: OpCopy, SourceRoot: "a", SourcePath: "dir", DestRoot: "b", DestPath: "dir"}
	if err := executor.Execute(context.Background(), item); err != nil {
		t.Fatal(err)
	}
	assertContent(t, filepath.Join(rootB, "dir", "child.txt"), "hello")
}

func executorFixture(t *testing.T) (string, string, Executor) {
	t.Helper()
	rootA := t.TempDir()
	rootB := t.TempDir()
	return rootA, rootB, Executor{Resolver: testResolver(rootA, rootB)}
}

func assertContent(t *testing.T, path, want string) {
	t.Helper()
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != want {
		t.Fatalf("%s = %q, want %q", path, string(body), want)
	}
}
