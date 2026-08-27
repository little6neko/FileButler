package superrename

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestExecutorRenamesMixedMediaAndCreatesVideoDirectory(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "image10.png"), "image10")
	testutil.WriteFile(t, filepath.Join(root, "A", "image2.JPG"), "image2")
	testutil.WriteFile(t, filepath.Join(root, "A", "clip10.mp4"), "clip10")
	testutil.WriteFile(t, filepath.Join(root, "A", "clip2.MKV"), "clip2")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	plan := scanAllPlan(t, resolver, "media", ".")

	executor := Executor{Resolver: resolver}
	if err := executor.ExecuteGroup(context.Background(), "job-mixed", "media", plan.Groups[0]); err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"A/01.JPG":     "image2",
		"A/02.png":     "image10",
		"A/视频/V01.MKV": "clip2",
		"A/视频/V02.mp4": "clip10",
	}
	for relativePath, content := range want {
		data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(relativePath)))
		if err != nil {
			t.Fatalf("read %s: %v", relativePath, err)
		}
		if string(data) != content {
			t.Fatalf("%s content = %q, want %q", relativePath, data, content)
		}
	}
	assertNoRecoveryResidue(t, filepath.Join(root, "A"))
}

func TestExecutorReusesExistingVideoDirectoryWithoutTouchingContents(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "clip.mp4"), "clip")
	testutil.WriteFile(t, filepath.Join(root, "A", "视频", "keep.txt"), "keep")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	plan := scanAllPlan(t, resolver, "media", ".")
	if plan.Groups[0].CreateVideoDirectory {
		t.Fatal("plan unexpectedly creates existing video directory")
	}

	if err := (Executor{Resolver: resolver}).ExecuteGroup(context.Background(), "job-existing", "media", plan.Groups[0]); err != nil {
		t.Fatal(err)
	}
	assertFileContent(t, filepath.Join(root, "A", "视频", "keep.txt"), "keep")
	assertFileContent(t, filepath.Join(root, "A", "视频", "V01.mp4"), "clip")
}

func TestExecutorStagesAllSourcesBeforeFinalizingRenameCycle(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "01.jpg"), "first")
	testutil.WriteFile(t, filepath.Join(root, "A", "02.jpg"), "second")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	group := PlanGroup{
		Path: "A",
		Name: "A",
		Items: []PlanItem{
			{SourcePath: "A/01.jpg", TargetPath: "A/02.jpg", MediaKind: MediaKindImage, Changed: true},
			{SourcePath: "A/02.jpg", TargetPath: "A/01.jpg", MediaKind: MediaKindImage, Changed: true},
		},
	}

	if err := (Executor{Resolver: resolver}).ExecuteGroup(context.Background(), "job-cycle", "media", group); err != nil {
		t.Fatal(err)
	}
	assertFileContent(t, filepath.Join(root, "A", "01.jpg"), "second")
	assertFileContent(t, filepath.Join(root, "A", "02.jpg"), "first")
}

func TestExecutorRollsBackAGroupWhenFinalizingFails(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "image2.jpg"), "two")
	testutil.WriteFile(t, filepath.Join(root, "A", "image10.jpg"), "ten")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	plan := scanAllPlan(t, resolver, "media", ".")
	injected := errors.New("injected finalize failure")
	failed := false
	fs := &faultingExecutorFileSystem{executorFileSystem: osExecutorFileSystem{}}
	fs.rename = func(oldPath string, newPath string) error {
		if !failed && strings.Contains(filepath.ToSlash(oldPath), "/files/") && filepath.Base(newPath) == "02.jpg" {
			failed = true
			return injected
		}
		return os.Rename(oldPath, newPath)
	}

	err := (Executor{Resolver: resolver, fileSystem: fs}).ExecuteGroup(context.Background(), "job-rollback", "media", plan.Groups[0])
	if !errors.Is(err, injected) {
		t.Fatalf("error = %v, want injected failure", err)
	}
	assertFileContent(t, filepath.Join(root, "A", "image2.jpg"), "two")
	assertFileContent(t, filepath.Join(root, "A", "image10.jpg"), "ten")
	if _, err := os.Lstat(filepath.Join(root, "A", "01.jpg")); !os.IsNotExist(err) {
		t.Fatalf("01.jpg still exists: %v", err)
	}
	assertNoRecoveryResidue(t, filepath.Join(root, "A"))
}

func TestExecutorKeepsManifestWhenRollbackCannotRestoreEverySource(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "image2.jpg"), "two")
	testutil.WriteFile(t, filepath.Join(root, "A", "image10.jpg"), "ten")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	plan := scanAllPlan(t, resolver, "media", ".")
	finalizeFailed := false
	restoreFailed := false
	fs := &faultingExecutorFileSystem{executorFileSystem: osExecutorFileSystem{}}
	fs.rename = func(oldPath string, newPath string) error {
		if !finalizeFailed && strings.Contains(filepath.ToSlash(oldPath), "/files/") && filepath.Base(newPath) == "02.jpg" {
			finalizeFailed = true
			return errors.New("finalize failed")
		}
		if finalizeFailed && !restoreFailed && filepath.Base(newPath) == "image2.jpg" {
			restoreFailed = true
			return errors.New("restore failed")
		}
		return os.Rename(oldPath, newPath)
	}

	err := (Executor{Resolver: resolver, fileSystem: fs}).ExecuteGroup(context.Background(), "job-recovery", "media", plan.Groups[0])
	var recoveryErr *RecoveryRequiredError
	if !errors.As(err, &recoveryErr) {
		t.Fatalf("error = %v, want RecoveryRequiredError", err)
	}
	if filepath.IsAbs(recoveryErr.StagePath) || !strings.HasPrefix(recoveryErr.StagePath, "A/"+recoveryPrefix) {
		t.Fatalf("public recovery path = %q", recoveryErr.StagePath)
	}
	manifestData, readErr := os.ReadFile(filepath.Join(root, filepath.FromSlash(recoveryErr.StagePath), "manifest.json"))
	if readErr != nil {
		t.Fatal(readErr)
	}
	var manifest recoveryManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.Phase != "rollback-failed" || len(manifest.Items) != 2 {
		t.Fatalf("manifest = %+v", manifest)
	}
	inventory, scanErr := (Scanner{Resolver: resolver}).Scan(context.Background(), "media", ".")
	if scanErr != nil {
		t.Fatal(scanErr)
	}
	if !reflect.DeepEqual(inventory.Groups[0].RecoveryResidues, []string{recoveryErr.StagePath}) {
		t.Fatalf("scanner residues = %v, want %q", inventory.Groups[0].RecoveryResidues, recoveryErr.StagePath)
	}
}

func TestExecutorDoesNotMoveSourcesWhenManifestCannotBeCreated(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "image.jpg"), "image")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	plan := scanAllPlan(t, resolver, "media", ".")
	injected := errors.New("manifest unavailable")
	executor := Executor{
		Resolver: resolver,
		writeManifest: func(string, recoveryManifest) error {
			return injected
		},
	}

	if err := executor.ExecuteGroup(context.Background(), "job-manifest", "media", plan.Groups[0]); !errors.Is(err, injected) {
		t.Fatalf("error = %v, want manifest failure", err)
	}
	assertFileContent(t, filepath.Join(root, "A", "image.jpg"), "image")
	assertNoRecoveryResidue(t, filepath.Join(root, "A"))
}

func TestExecutorRejectsAStaleOccupiedTargetBeforeStaging(t *testing.T) {
	root := t.TempDir()
	testutil.WriteFile(t, filepath.Join(root, "A", "image.jpg"), "image")
	testutil.WriteFile(t, filepath.Join(root, "A", "01.jpg"), "occupied")
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	group := PlanGroup{
		Path: "A",
		Name: "A",
		Items: []PlanItem{
			{SourcePath: "A/image.jpg", TargetPath: "A/01.jpg", MediaKind: MediaKindImage, Changed: true},
		},
	}

	err := (Executor{Resolver: resolver}).ExecuteGroup(context.Background(), "job-stale", "media", group)
	if !errors.Is(err, ErrExecutionStale) {
		t.Fatalf("error = %v, want ErrExecutionStale", err)
	}
	assertFileContent(t, filepath.Join(root, "A", "image.jpg"), "image")
	assertFileContent(t, filepath.Join(root, "A", "01.jpg"), "occupied")
	assertNoRecoveryResidue(t, filepath.Join(root, "A"))
}

func TestExecutorHandlesThreeHundredFiles(t *testing.T) {
	root := t.TempDir()
	for index := 1; index <= 300; index++ {
		testutil.WriteFile(t, filepath.Join(root, "A", fmt.Sprintf("image-%d.jpg", index)), fmt.Sprintf("%d", index))
	}
	resolver := roots.NewResolver([]roots.Root{{ID: "media", Path: root}})
	plan := scanAllPlan(t, resolver, "media", ".")
	if len(plan.Groups[0].Items) != 300 || plan.Groups[0].Items[0].TargetPath != "A/001.jpg" || plan.Groups[0].Items[299].TargetPath != "A/300.jpg" {
		t.Fatalf("unexpected 300-item plan boundaries: first=%+v last=%+v", plan.Groups[0].Items[0], plan.Groups[0].Items[299])
	}

	if err := (Executor{Resolver: resolver}).ExecuteGroup(context.Background(), "job-300", "media", plan.Groups[0]); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(root, "A"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 300 {
		t.Fatalf("entry count = %d, want 300", len(entries))
	}
	assertFileContent(t, filepath.Join(root, "A", "001.jpg"), "1")
	assertFileContent(t, filepath.Join(root, "A", "300.jpg"), "300")
}

type faultingExecutorFileSystem struct {
	executorFileSystem
	rename func(oldPath string, newPath string) error
}

func (fs *faultingExecutorFileSystem) Rename(oldPath string, newPath string) error {
	if fs.rename != nil {
		return fs.rename(oldPath, newPath)
	}
	return fs.executorFileSystem.Rename(oldPath, newPath)
}

func scanAllPlan(t *testing.T, resolver roots.Resolver, rootID string, directoryPath string) Plan {
	t.Helper()
	inventory, err := (Scanner{Resolver: resolver}).Scan(context.Background(), rootID, directoryPath)
	if err != nil {
		t.Fatal(err)
	}
	selected := make([]string, 0)
	for _, group := range inventory.Groups {
		for _, candidate := range group.Images {
			selected = append(selected, candidate.SourcePath)
		}
		for _, candidate := range group.Videos {
			selected = append(selected, candidate.SourcePath)
		}
	}
	plan, err := BuildPlan(inventory, selected)
	if err != nil {
		t.Fatal(err)
	}
	if plan.HasConflict {
		t.Fatalf("unexpected plan conflict: %+v", plan)
	}
	return plan
}

func assertNoRecoveryResidue(t *testing.T, directory string) {
	t.Helper()
	entries, err := os.ReadDir(directory)
	if err != nil {
		t.Fatal(err)
	}
	residues := make([]string, 0)
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), recoveryPrefix) {
			residues = append(residues, entry.Name())
		}
	}
	sort.Strings(residues)
	if len(residues) > 0 {
		t.Fatalf("recovery residues remain: %v", residues)
	}
}

func assertFileContent(t *testing.T, path string, want string) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != want {
		t.Fatalf("%s content = %q, want %q", path, data, want)
	}
}
