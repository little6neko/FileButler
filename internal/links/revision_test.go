package links

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"
)

func TestPreviewRevisionIsStableAndIgnoresContentChangesOnSameObject(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	file := filepath.Join(sourceRoot, "set", "file.txt")
	mustWrite(t, file, "first")
	planner := testPlanner(sourceRoot, destRoot)
	request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: "."}

	first := mustPlan(t, planner, request)
	second := mustPlan(t, planner, request)
	if first.Preview.PreviewRevision != second.Preview.PreviewRevision {
		t.Fatalf("stable plans differ: %q %q", first.Preview.PreviewRevision, second.Preview.PreviewRevision)
	}
	if !regexp.MustCompile(`^sha256:[0-9a-f]{64}$`).MatchString(first.Preview.PreviewRevision) {
		t.Fatalf("revision = %q", first.Preview.PreviewRevision)
	}
	mustWrite(t, file, "different content on the same inode")
	if err := os.Chtimes(file, time.Unix(100, 0), time.Unix(200, 0)); err != nil {
		t.Fatal(err)
	}
	afterContent := mustPlan(t, planner, request)
	if first.Preview.PreviewRevision != afterContent.Preview.PreviewRevision {
		t.Fatalf("content-only change altered revision: %q %q", first.Preview.PreviewRevision, afterContent.Preview.PreviewRevision)
	}
}

func TestPreviewRevisionChangesWithDirectoryPlanInputs(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	album := filepath.Join(sourceRoot, "set", "album")
	mustWrite(t, filepath.Join(album, "one.jpg"), "one")
	planner := testPlanner(sourceRoot, destRoot)
	request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: "."}

	baseline := mustPlan(t, planner, request).Preview.PreviewRevision
	mustWrite(t, filepath.Join(album, "two.jpg"), "two")
	afterAdd := mustPlan(t, planner, request).Preview.PreviewRevision
	if baseline == afterAdd {
		t.Fatal("adding a source entry did not change revision")
	}
	if err := os.Chmod(album, 0o700); err != nil {
		t.Fatal(err)
	}
	afterMode := mustPlan(t, planner, request).Preview.PreviewRevision
	if afterAdd == afterMode {
		t.Fatal("changing directory mode did not change revision")
	}
	if err := os.Chtimes(album, time.Unix(300, 0), time.Unix(400, 0)); err != nil {
		t.Fatal(err)
	}
	afterTime := mustPlan(t, planner, request).Preview.PreviewRevision
	if afterMode == afterTime {
		t.Fatal("changing directory modification time did not change revision")
	}
}

func TestPreviewRevisionChangesWithSymlinkMappingAndTargetOccupancy(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	album := filepath.Join(sourceRoot, "set", "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(album, "link")
	if err := os.Symlink("first.jpg", link); err != nil {
		t.Fatal(err)
	}
	planner := testPlanner(sourceRoot, destRoot)
	request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/album"}, DestRoot: "dest", DestPath: "."}

	baseline := mustPlan(t, planner, request).Preview.PreviewRevision
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("second.jpg", link); err != nil {
		t.Fatal(err)
	}
	afterLink := mustPlan(t, planner, request).Preview.PreviewRevision
	if baseline == afterLink {
		t.Fatal("changing symlink target did not change revision")
	}
	if err := os.Mkdir(filepath.Join(destRoot, "album"), 0o755); err != nil {
		t.Fatal(err)
	}
	afterOccupancy := mustPlan(t, planner, request).Preview.PreviewRevision
	if afterLink == afterOccupancy {
		t.Fatal("target occupancy did not change revision")
	}
}

func TestPreviewRevisionChangesWhenSourceObjectIsReplaced(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	file := filepath.Join(sourceRoot, "set", "file.txt")
	oldObject := filepath.Join(sourceRoot, "set", "old-object.txt")
	mustWrite(t, file, "old")
	if err := os.Link(file, oldObject); err != nil {
		t.Fatal(err)
	}
	planner := testPlanner(sourceRoot, destRoot)
	request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: "."}
	baseline := mustPlan(t, planner, request).Preview.PreviewRevision

	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, file, "replacement")
	afterReplacement := mustPlan(t, planner, request).Preview.PreviewRevision
	if baseline == afterReplacement {
		t.Fatal("replacing a source object did not change revision")
	}
}

func TestPreviewRevisionIncludesDestinationFilesystemIdentity(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	file := filepath.Join(sourceRoot, "set", "file.txt")
	mustWrite(t, file, "source")
	planner := testPlanner(sourceRoot, destRoot)
	request := Request{Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: "."}
	baseline := mustPlan(t, planner, request).Preview.PreviewRevision

	defaultIdentity := planner.identityReader()
	planner.identity = func(path string, follow bool) (FileIdentity, error) {
		identity, err := defaultIdentity(path, follow)
		if err == nil && filepath.Clean(path) == filepath.Clean(destRoot) {
			identity.VolumeID = "changed-volume"
			identity.ObjectID = "changed-directory"
		}
		return identity, err
	}
	afterFilesystem := mustPlan(t, planner, request).Preview.PreviewRevision
	if baseline == afterFilesystem {
		t.Fatal("destination filesystem identity did not change revision")
	}
}

func mustPlan(t *testing.T, planner Planner, request Request) Plan {
	t.Helper()
	plan, err := planner.Plan(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	return plan
}
