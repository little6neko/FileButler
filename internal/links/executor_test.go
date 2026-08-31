package links

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type reportedStep struct {
	step PlanStep
	err  error
}

func TestExecutorStagesAndCommitsOrdinaryHardlink(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	source := filepath.Join(sourceRoot, "set", "file.txt")
	mustWrite(t, source, "content")
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	})
	reports := []reportedStep{}
	executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
	err := executor.ExecuteGroup(context.Background(), "job-1", plan.Groups[0], ExecutionHooks{
		Report: func(step PlanStep, stepErr error) error {
			reports = append(reports, reportedStep{step: step, err: stepErr})
			return nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(destRoot, "file.txt")
	if !mustIdentity(t, source, false).SameObject(mustIdentity(t, destination, false)) {
		t.Fatal("destination is not a hardlink to the source")
	}
	assertReports(t, reports, 1)
	assertNoStagingContainers(t, destRoot)
}

func TestExecutorStagesAndCommitsOrdinaryRelativeSymlink(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	source := filepath.Join(sourceRoot, "set", "file.txt")
	mustWrite(t, source, "content")
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkSymlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	})
	executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
	if err := executor.ExecuteGroup(context.Background(), "job-1", plan.Groups[0], ExecutionHooks{}); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(destRoot, "file.txt")
	target, err := os.Readlink(destination)
	if err != nil {
		t.Fatal(err)
	}
	if target != RelativeLinkTarget(destRoot, source) {
		t.Fatalf("target = %q", target)
	}
	assertNoStagingContainers(t, destRoot)
}

func TestExecutorBuildsDirectoryCloneAndPreservesDirectoryMetadata(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	album := filepath.Join(sourceRoot, "set", "album")
	file := filepath.Join(album, "nested", "file.jpg")
	mustWrite(t, file, "content")
	if err := os.Mkdir(filepath.Join(album, "empty"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join("nested", "file.jpg"), filepath.Join(album, "internal")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("missing.jpg", filepath.Join(album, "broken")); err != nil {
		t.Fatal(err)
	}
	shared := filepath.Join(sourceRoot, "shared.jpg")
	mustWrite(t, shared, "shared")
	if err := os.Symlink(filepath.Join("..", "..", "shared.jpg"), filepath.Join(album, "external")); err != nil {
		t.Fatal(err)
	}
	mtime := time.Unix(1_700_000_000, 0)
	if err := os.Chmod(filepath.Join(album, "nested"), 0o710); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(filepath.Join(album, "nested"), mtime, mtime); err != nil {
		t.Fatal(err)
	}
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
	})
	reports := []reportedStep{}
	executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
	if err := executor.ExecuteGroup(context.Background(), "job-1", plan.Groups[0], ExecutionHooks{
		Report: func(step PlanStep, stepErr error) error {
			reports = append(reports, reportedStep{step: step, err: stepErr})
			return nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(destRoot, "album")
	if !mustIdentity(t, file, false).SameObject(mustIdentity(t, filepath.Join(destination, "nested", "file.jpg"), false)) {
		t.Fatal("cloned file is not a hardlink")
	}
	for _, name := range []string{"internal", "broken", "external"} {
		if _, err := os.Readlink(filepath.Join(destination, name)); err != nil {
			t.Fatalf("Readlink(%s): %v", name, err)
		}
	}
	externalTarget, err := os.Readlink(filepath.Join(destination, "external"))
	if err != nil {
		t.Fatal(err)
	}
	if resolved := filepath.Clean(filepath.Join(destination, externalTarget)); resolved != shared {
		t.Fatalf("external link resolves to %q, want %q", resolved, shared)
	}
	nestedInfo, err := os.Stat(filepath.Join(destination, "nested"))
	if err != nil {
		t.Fatal(err)
	}
	if nestedInfo.Mode().Perm() != 0o710 || nestedInfo.ModTime().Unix() != mtime.Unix() {
		t.Fatalf("nested metadata = mode %o, mtime %v", nestedInfo.Mode().Perm(), nestedInfo.ModTime())
	}
	assertReports(t, reports, plan.Preview.ProgressTotal)
	if reports[len(reports)-1].step.Action != ActionDirectory || reports[len(reports)-1].step.RelativePath != "." {
		t.Fatalf("top directory was not reported after commit: %+v", reports)
	}
	assertNoStagingContainers(t, destRoot)
}

func TestExecutorCleansCurrentGroupAfterFailure(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	for index := 1; index <= 3; index++ {
		mustWrite(t, filepath.Join(sourceRoot, "set", "album", fmt.Sprintf("%d.txt", index)), "content")
	}
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
	})
	failing := &faultExecutorFileSystem{executorFileSystem: osExecutorFileSystem{}, operation: "link", failAt: 2}
	reports := []reportedStep{}
	executor := Executor{Planner: planner, Staging: NewStagingManager("runtime"), fileSystem: failing}
	err := executor.ExecuteGroup(context.Background(), "job-1", plan.Groups[0], ExecutionHooks{
		Report: func(step PlanStep, stepErr error) error {
			reports = append(reports, reportedStep{step: step, err: stepErr})
			return nil
		},
	})
	if err == nil || len(reports) != 2 || reports[len(reports)-1].err == nil {
		t.Fatalf("err = %v, reports = %+v", err, reports)
	}
	if _, err := os.Lstat(filepath.Join(destRoot, "album")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("destination err = %v", err)
	}
	assertNoStagingContainers(t, destRoot)
}

func TestExecutorCleansOnCancellationAndLeavesPriorFilesystemUntouched(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	for index := 1; index <= 3; index++ {
		mustWrite(t, filepath.Join(sourceRoot, "set", "album", fmt.Sprintf("%d.txt", index)), "content")
	}
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
	})
	ctx, cancel := context.WithCancel(context.Background())
	executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
	reported := 0
	err := executor.ExecuteGroup(ctx, "job-1", plan.Groups[0], ExecutionHooks{
		Report: func(PlanStep, error) error {
			reported++
			if reported == 2 {
				cancel()
			}
			return nil
		},
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want canceled", err)
	}
	if _, err := os.Lstat(filepath.Join(destRoot, "album")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("destination err = %v", err)
	}
	assertNoStagingContainers(t, destRoot)
}

func TestExecutorRejectsSourceChangeAndConcurrentTargetOccupancy(t *testing.T) {
	t.Run("source changed before execution", func(t *testing.T) {
		sourceRoot := t.TempDir()
		destRoot := t.TempDir()
		file := filepath.Join(sourceRoot, "set", "file.txt")
		mustWrite(t, file, "old")
		if err := os.Link(file, filepath.Join(sourceRoot, "set", "old-object.txt")); err != nil {
			t.Fatal(err)
		}
		planner := testPlanner(sourceRoot, destRoot)
		plan := mustPlan(t, planner, Request{
			Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
		})
		if err := os.Remove(file); err != nil {
			t.Fatal(err)
		}
		mustWrite(t, file, "replacement")
		executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
		if err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{}); !errors.Is(err, ErrSourceChanged) {
			t.Fatalf("err = %v, want source changed", err)
		}
		assertNoStagingContainers(t, destRoot)
	})

	t.Run("target occupied before commit", func(t *testing.T) {
		sourceRoot := t.TempDir()
		destRoot := t.TempDir()
		mustWrite(t, filepath.Join(sourceRoot, "set", "album", "file.txt"), "source")
		planner := testPlanner(sourceRoot, destRoot)
		plan := mustPlan(t, planner, Request{
			Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
		})
		executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
		occupied := false
		err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{
			Report: func(step PlanStep, stepErr error) error {
				if step.Action == ActionHardlink && !occupied {
					occupied = true
					mustWrite(t, filepath.Join(destRoot, "album", "user.txt"), "user")
				}
				return nil
			},
		})
		if !errors.Is(err, ErrTargetExists) {
			t.Fatalf("err = %v, want target exists", err)
		}
		if body, err := os.ReadFile(filepath.Join(destRoot, "album", "user.txt")); err != nil || string(body) != "user" {
			t.Fatalf("user target = %q, err = %v", body, err)
		}
		assertNoStagingContainers(t, destRoot)
	})
}

func TestExecutorFinalRescanDetectsTreeChangesButAllowsSameObjectContentChanges(t *testing.T) {
	t.Run("new tree entry aborts commit", func(t *testing.T) {
		sourceRoot := t.TempDir()
		destRoot := t.TempDir()
		album := filepath.Join(sourceRoot, "set", "album")
		mustWrite(t, filepath.Join(album, "one.txt"), "one")
		planner := testPlanner(sourceRoot, destRoot)
		plan := mustPlan(t, planner, Request{
			Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
		})
		executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
		changed := false
		err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{
			Report: func(step PlanStep, stepErr error) error {
				if step.Action == ActionHardlink && !changed {
					changed = true
					mustWrite(t, filepath.Join(album, "two.txt"), "two")
				}
				return nil
			},
		})
		if !errors.Is(err, ErrSourceChanged) {
			t.Fatalf("err = %v, want source changed", err)
		}
		if _, err := os.Lstat(filepath.Join(destRoot, "album")); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("destination err = %v", err)
		}
		assertNoStagingContainers(t, destRoot)
	})

	t.Run("content change on same object commits", func(t *testing.T) {
		sourceRoot := t.TempDir()
		destRoot := t.TempDir()
		file := filepath.Join(sourceRoot, "set", "album", "one.txt")
		mustWrite(t, file, "old")
		planner := testPlanner(sourceRoot, destRoot)
		plan := mustPlan(t, planner, Request{
			Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
		})
		executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
		changed := false
		err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{
			Report: func(step PlanStep, stepErr error) error {
				if step.Action == ActionHardlink && !changed {
					changed = true
					if err := os.WriteFile(file, []byte("new"), 0o644); err != nil {
						t.Fatal(err)
					}
				}
				return nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		body, err := os.ReadFile(filepath.Join(destRoot, "album", "one.txt"))
		if err != nil || string(body) != "new" {
			t.Fatalf("destination = %q, err = %v", body, err)
		}
	})
}

func TestExecutorHandlesMoreThanThreeHundredEntries(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	for index := 0; index < 320; index++ {
		mustWrite(t, filepath.Join(sourceRoot, "set", "album", fmt.Sprintf("%03d.txt", index)), "content")
	}
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
	})
	executor := Executor{Planner: planner, Staging: NewStagingManager("runtime")}
	if err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(destRoot, "album"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 320 {
		t.Fatalf("entries = %d", len(entries))
	}
}

func TestExecutorReturnsSafeIdentifierWhenPostCommitCleanupFails(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "content")
	planner := testPlanner(sourceRoot, destRoot)
	plan := mustPlan(t, planner, Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	})
	manager := NewStagingManager("runtime")
	manager.fileSystem = &faultStagingFileSystem{
		stagingFileSystem: osStagingFileSystem{}, operation: "remove-all",
	}
	executor := Executor{Planner: planner, Staging: manager}
	err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{})
	var cleanupError *StagingCleanupError
	if !errors.As(err, &cleanupError) || !errors.Is(err, ErrStagingCleanup) {
		t.Fatalf("err = %v, want staging cleanup error", err)
	}
	if strings.Contains(err.Error(), destRoot) || !strings.Contains(err.Error(), stagingPrefix) {
		t.Fatalf("unsafe cleanup error = %q", err.Error())
	}
	if _, err := os.Stat(filepath.Join(destRoot, "file.txt")); err != nil {
		t.Fatalf("committed destination missing: %v", err)
	}
	entries, readErr := os.ReadDir(destRoot)
	if readErr != nil {
		t.Fatal(readErr)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), stagingPrefix) {
			if removeErr := os.RemoveAll(filepath.Join(destRoot, entry.Name())); removeErr != nil {
				t.Fatal(removeErr)
			}
		}
	}
}

func TestExecutorCleansStagingAtFilesystemFailurePoints(t *testing.T) {
	for _, operation := range []string{"lstat", "readlink", "mkdir", "link", "symlink", "chtimes", "chmod", "rename"} {
		t.Run(operation, func(t *testing.T) {
			sourceRoot := t.TempDir()
			destRoot := t.TempDir()
			album := filepath.Join(sourceRoot, "set", "album")
			mustWrite(t, filepath.Join(album, "nested", "file.txt"), "content")
			if err := os.Symlink(filepath.Join("nested", "file.txt"), filepath.Join(album, "link")); err != nil {
				t.Fatal(err)
			}
			planner := testPlanner(sourceRoot, destRoot)
			plan := mustPlan(t, planner, Request{
				Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: ".",
			})
			fileSystem := &faultExecutorFileSystem{
				executorFileSystem: osExecutorFileSystem{}, operation: operation, failAt: 1,
			}
			executor := Executor{Planner: planner, Staging: NewStagingManager("runtime"), fileSystem: fileSystem}
			if err := executor.ExecuteGroup(context.Background(), "job", plan.Groups[0], ExecutionHooks{}); err == nil {
				t.Fatalf("%s failure returned nil", operation)
			}
			if _, err := os.Lstat(filepath.Join(destRoot, "album")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("destination err = %v", err)
			}
			assertNoStagingContainers(t, destRoot)
		})
	}
}

type faultExecutorFileSystem struct {
	executorFileSystem
	operation string
	failAt    int
	calls     int
}

func (fs *faultExecutorFileSystem) Link(oldPath string, newPath string) error {
	if fs.shouldFail("link") {
		return errors.New("injected link failure")
	}
	return fs.executorFileSystem.Link(oldPath, newPath)
}

func (fs *faultExecutorFileSystem) Lstat(path string) (os.FileInfo, error) {
	if fs.shouldFail("lstat") {
		return nil, errors.New("injected lstat failure")
	}
	return fs.executorFileSystem.Lstat(path)
}

func (fs *faultExecutorFileSystem) Readlink(path string) (string, error) {
	if fs.shouldFail("readlink") {
		return "", errors.New("injected readlink failure")
	}
	return fs.executorFileSystem.Readlink(path)
}

func (fs *faultExecutorFileSystem) Mkdir(path string, mode os.FileMode) error {
	if fs.shouldFail("mkdir") {
		return errors.New("injected mkdir failure")
	}
	return fs.executorFileSystem.Mkdir(path, mode)
}

func (fs *faultExecutorFileSystem) Symlink(target string, path string) error {
	if fs.shouldFail("symlink") {
		return errors.New("injected symlink failure")
	}
	return fs.executorFileSystem.Symlink(target, path)
}

func (fs *faultExecutorFileSystem) Chtimes(path string, accessTime time.Time, modifiedTime time.Time) error {
	if fs.shouldFail("chtimes") {
		return errors.New("injected chtimes failure")
	}
	return fs.executorFileSystem.Chtimes(path, accessTime, modifiedTime)
}

func (fs *faultExecutorFileSystem) Chmod(path string, mode os.FileMode) error {
	if fs.shouldFail("chmod") {
		return errors.New("injected chmod failure")
	}
	return fs.executorFileSystem.Chmod(path, mode)
}

func (fs *faultExecutorFileSystem) RenameNoReplace(source string, destination string) error {
	if fs.shouldFail("rename") {
		return errors.New("injected rename failure")
	}
	return fs.executorFileSystem.RenameNoReplace(source, destination)
}

func (fs *faultExecutorFileSystem) shouldFail(operation string) bool {
	if fs.operation != operation {
		return false
	}
	fs.calls++
	return fs.calls == fs.failAt
}

func assertReports(t *testing.T, reports []reportedStep, want int) {
	t.Helper()
	if len(reports) != want {
		t.Fatalf("reports = %d, want %d: %+v", len(reports), want, reports)
	}
	for _, report := range reports {
		if report.err != nil {
			t.Fatalf("unexpected report error: %+v", report)
		}
	}
}

func assertNoStagingContainers(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), stagingPrefix) {
			t.Fatalf("staging residue remains: %s", entry.Name())
		}
	}
}
