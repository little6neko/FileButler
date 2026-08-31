package links

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/little6neko/filebutler/internal/roots"
)

func TestPlannerPlansOrdinaryFileHardlink(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "photo.jpg"), "photo")
	planner := testPlanner(sourceRoot, destRoot)

	plan, err := planner.Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/photo.jpg"}, DestRoot: "dest", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Preview.HasConflict || plan.Preview.ProgressTotal != 1 || len(plan.Groups) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	item := plan.Preview.Items[0]
	if item.SourceKind != SourceFile || item.DestPath != "photo.jpg" || item.Counts != (Counts{Files: 1}) {
		t.Fatalf("item = %+v", item)
	}
	if len(plan.Groups[0].Steps) != 1 || plan.Groups[0].Steps[0].Action != ActionHardlink {
		t.Fatalf("steps = %+v", plan.Groups[0].Steps)
	}
}

func TestPlannerPlansDirectoryHardlinkCloneWithoutFollowingSymlinks(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	album := filepath.Join(sourceRoot, "set", "相册(一)")
	if err := os.MkdirAll(filepath.Join(album, "empty"), 0o750); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(album, "nested", "photo.jpg"), "photo")
	mustWrite(t, filepath.Join(sourceRoot, "shared.jpg"), "shared")
	links := map[string]string{
		filepath.Join(album, "internal"): filepath.Join("nested", "photo.jpg"),
		filepath.Join(album, "external"): filepath.Join("..", "..", "shared.jpg"),
		filepath.Join(album, "broken"):   "missing.jpg",
	}
	for link, target := range links {
		if err := os.Symlink(target, link); err != nil {
			t.Fatal(err)
		}
	}
	planner := testPlanner(sourceRoot, destRoot)

	plan, err := planner.Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/相册(一)"}, DestRoot: "dest", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	item := plan.Preview.Items[0]
	if item.Conflict || item.SourceKind != SourceDirectory || item.Counts != (Counts{Directories: 3, Files: 1, Symlinks: 3}) {
		t.Fatalf("item = %+v", item)
	}
	if plan.Preview.ProgressTotal != 7 {
		t.Fatalf("progress total = %d", plan.Preview.ProgressTotal)
	}
	steps := plan.Groups[0].Steps
	if len(steps) != 7 {
		t.Fatalf("steps = %+v", steps)
	}
	internal := findStep(t, steps, "internal")
	broken := findStep(t, steps, "broken")
	external := findStep(t, steps, "external")
	if internal.Mapping != MappingInternal || broken.Mapping != MappingInternal || external.Mapping != MappingExternal {
		t.Fatalf("link mappings: internal=%+v broken=%+v external=%+v", internal, broken, external)
	}
}

func TestPlannerPlansOneSymlinkForFileOrDirectory(t *testing.T) {
	for _, test := range []struct {
		name string
		path string
		kind SourceKind
	}{
		{name: "file", path: "set/file.txt", kind: SourceFile},
		{name: "directory", path: "set/folder", kind: SourceDirectory},
	} {
		t.Run(test.name, func(t *testing.T) {
			sourceRoot := t.TempDir()
			destRoot := t.TempDir()
			if test.kind == SourceFile {
				mustWrite(t, filepath.Join(sourceRoot, test.path), "file")
			} else if err := os.MkdirAll(filepath.Join(sourceRoot, test.path, "nested"), 0o755); err != nil {
				t.Fatal(err)
			}
			plan, err := testPlanner(sourceRoot, destRoot).Plan(context.Background(), Request{
				Type: LinkSymlink, SourceRoot: "source", Sources: []string{test.path}, DestRoot: "dest", DestPath: ".",
			})
			if err != nil {
				t.Fatal(err)
			}
			item := plan.Preview.Items[0]
			if item.Conflict || item.SourceKind != test.kind || item.Counts != (Counts{Symlinks: 1}) || plan.Preview.ProgressTotal != 1 {
				t.Fatalf("plan = %+v", plan)
			}
		})
	}
}

func TestPlannerReportsStableTopLevelConflicts(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "source")
	mustWrite(t, filepath.Join(destRoot, "file.txt"), "occupied")
	if err := os.Symlink("file.txt", filepath.Join(sourceRoot, "set", "link.txt")); err != nil {
		t.Fatal(err)
	}
	planner := testPlanner(sourceRoot, destRoot)

	occupied, err := planner.Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !occupied.Preview.HasConflict || occupied.Preview.Items[0].ErrorCode != ErrorTargetExists {
		t.Fatalf("occupied = %+v", occupied.Preview)
	}
	unsupported, err := planner.Plan(context.Background(), Request{
		Type: LinkSymlink, SourceRoot: "source", Sources: []string{"set/link.txt"}, DestRoot: "dest", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !unsupported.Preview.HasConflict || unsupported.Preview.Items[0].ErrorCode != ErrorUnsupportedSource {
		t.Fatalf("unsupported = %+v", unsupported.Preview)
	}
}

func TestPlannerRejectsDestinationInsideDirectorySource(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "set", "album", "target"), 0o755); err != nil {
		t.Fatal(err)
	}
	planner := Planner{Resolver: roots.NewResolver([]roots.Root{{ID: "root", Name: "Root", Path: root}})}

	plan, err := planner.Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "root", Sources: []string{"set/album"}, DestRoot: "root", DestPath: "set/album/target",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Preview.HasConflict || plan.Preview.Items[0].ErrorCode != ErrorDestinationInsideSource {
		t.Fatalf("plan = %+v", plan.Preview)
	}
}

func TestPlannerRejectsInvalidSourceSets(t *testing.T) {
	root := t.TempDir()
	dest := t.TempDir()
	mustWrite(t, filepath.Join(root, "one", "a.txt"), "a")
	mustWrite(t, filepath.Join(root, "two", "b.txt"), "b")
	planner := testPlanner(root, dest)
	tests := []struct {
		name    string
		sources []string
	}{
		{name: "empty", sources: nil},
		{name: "blank", sources: []string{""}},
		{name: "root", sources: []string{"."}},
		{name: "duplicate", sources: []string{"one/a.txt", "one/a.txt"}},
		{name: "different parents", sources: []string{"one/a.txt", "two/b.txt"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := planner.Plan(context.Background(), Request{
				Type: LinkHardlink, SourceRoot: "source", Sources: test.sources, DestRoot: "dest", DestPath: ".",
			})
			if !errors.Is(err, ErrInvalidRequest) {
				t.Fatalf("err = %v, want invalid request", err)
			}
		})
	}
}

func TestPlannerDetectsCrossFilesystemFromIdentity(t *testing.T) {
	sourceRoot := t.TempDir()
	destRoot := t.TempDir()
	mustWrite(t, filepath.Join(sourceRoot, "set", "file.txt"), "source")
	planner := testPlanner(sourceRoot, destRoot)
	defaultIdentity := planner.identityReader()
	planner.identity = func(path string, follow bool) (FileIdentity, error) {
		identity, err := defaultIdentity(path, follow)
		if err == nil && strings.HasSuffix(path, "file.txt") {
			identity.VolumeID = "different-volume"
		}
		return identity, err
	}

	plan, err := planner.Plan(context.Background(), Request{
		Type: LinkHardlink, SourceRoot: "source", Sources: []string{"set/file.txt"}, DestRoot: "dest", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Preview.HasConflict || plan.Preview.Items[0].ErrorCode != ErrorCrossFilesystem {
		t.Fatalf("plan = %+v", plan.Preview)
	}
}

func testPlanner(sourceRoot string, destRoot string) Planner {
	return Planner{Resolver: roots.NewResolver([]roots.Root{
		{ID: "source", Name: "Source", Path: sourceRoot},
		{ID: "dest", Name: "Destination", Path: destRoot},
	})}
}

func findStep(t *testing.T, steps []PlanStep, relativePath string) PlanStep {
	t.Helper()
	for _, step := range steps {
		if step.RelativePath == relativePath {
			return step
		}
	}
	t.Fatalf("step %q not found in %+v", relativePath, steps)
	return PlanStep{}
}
