package links

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/jobs"
)

func TestStagingMaintainerHidesActiveAndCleansInactiveOrOldRuntimeContainers(t *testing.T) {
	directory := t.TempDir()
	store := jobs.NewStore()
	if err := store.Create(context.Background(), jobs.Job{ID: "active", Type: "hardlink", ProgressTotal: 1}); err != nil {
		t.Fatal(err)
	}
	manager := NewStagingManager(store.RuntimeID())
	active, err := manager.Create(directory, "active", "active-target", testRevision)
	if err != nil {
		t.Fatal(err)
	}
	inactive, err := manager.Create(directory, "inactive", "inactive-target", testRevision)
	if err != nil {
		t.Fatal(err)
	}
	oldManager := NewStagingManager("old-runtime")
	old, err := oldManager.Create(directory, "old", "old-target", testRevision)
	if err != nil {
		t.Fatal(err)
	}
	lookalike := filepath.Join(directory, stagingPrefix+"user")
	if err := os.Mkdir(lookalike, 0o700); err != nil {
		t.Fatal(err)
	}

	maintainer := StagingMaintainer{Manager: manager, Jobs: store}
	hidden, err := maintainer.Maintain(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := hidden[filepath.Base(active.Container)]; !ok || len(hidden) != 1 {
		t.Fatalf("hidden = %v", hidden)
	}
	for _, removed := range []string{inactive.Container, old.Container} {
		if _, err := os.Lstat(removed); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("stale container %q err = %v", filepath.Base(removed), err)
		}
	}
	if _, err := os.Lstat(lookalike); err != nil {
		t.Fatalf("lookalike was removed: %v", err)
	}
}

func TestStagingMaintainerHidesValidContainerWhenCleanupFails(t *testing.T) {
	directory := t.TempDir()
	store := jobs.NewStore()
	manager := NewStagingManager(store.RuntimeID())
	area, err := manager.Create(directory, "inactive", "target", testRevision)
	if err != nil {
		t.Fatal(err)
	}
	manager.fileSystem = &faultStagingFileSystem{
		stagingFileSystem: osStagingFileSystem{}, operation: "remove-all",
	}
	maintainer := StagingMaintainer{Manager: manager, Jobs: store}

	hidden, err := maintainer.Maintain(context.Background(), directory)
	if err == nil || strings.Contains(err.Error(), directory) {
		t.Fatalf("err = %v", err)
	}
	if _, ok := hidden[filepath.Base(area.Container)]; !ok {
		t.Fatalf("hidden = %v", hidden)
	}
	if _, err := os.Lstat(area.Container); err != nil {
		t.Fatalf("container unexpectedly removed: %v", err)
	}
}

func TestPlannerMaintainsDestinationBeforeScanning(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "source")
	maintainer := &recordingLinkMaintainer{}
	planner := testPlanner(sourceRoot, destRoot)
	planner.Maintainer = maintainer

	if _, err := planner.Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	}); err != nil {
		t.Fatal(err)
	}
	if maintainer.directory != destRoot {
		t.Fatalf("maintained directory = %q", maintainer.directory)
	}
}

type recordingLinkMaintainer struct {
	directory string
}

func (maintainer *recordingLinkMaintainer) Maintain(_ context.Context, directory string) (map[string]struct{}, error) {
	maintainer.directory = directory
	return nil, nil
}
