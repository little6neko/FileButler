package ops

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/testutil"
)

func TestPlanCopyDetectsExistingDestination(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "x")
	testutil.WriteFile(t, filepath.Join(rootB, "a.txt"), "y")
	planner := Planner{Resolver: testResolver(rootA, rootB)}

	plan, err := planner.Plan(context.Background(), Request{Type: OpCopy, SourceRoot: "a", Sources: []string{"a.txt"}, DestRoot: "b", DestPath: "."})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "target_exists" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanMoveDetectsMissingSource(t *testing.T) {
	planner := Planner{Resolver: testResolver(t.TempDir(), t.TempDir())}
	plan, err := planner.Plan(context.Background(), Request{Type: OpMove, SourceRoot: "a", Sources: []string{"missing.txt"}, DestRoot: "b", DestPath: "."})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "missing_source" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanHardLinkRejectsDirectory(t *testing.T) {
	rootA := t.TempDir()
	rootB := t.TempDir()
	planner := Planner{Resolver: testResolver(rootA, rootB)}
	plan, err := planner.Plan(context.Background(), Request{Type: OpHardlink, SourceRoot: "a", Sources: []string{"."}, DestRoot: "b", DestPath: "."})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "hardlink_directory" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanDeleteHasNoDestination(t *testing.T) {
	rootA := t.TempDir()
	testutil.WriteFile(t, filepath.Join(rootA, "a.txt"), "x")
	planner := Planner{Resolver: roots.NewResolver([]roots.Root{{ID: "a", Name: "A", Path: rootA}})}
	plan, err := planner.Plan(context.Background(), Request{Type: OpDelete, SourceRoot: "a", Sources: []string{"a.txt"}})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].DestPath != "" || plan.HasConflict {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanMkdirDetectsExistingPath(t *testing.T) {
	rootA := t.TempDir()
	testutil.WriteFile(t, filepath.Join(rootA, "new"), "x")
	planner := Planner{Resolver: roots.NewResolver([]roots.Root{{ID: "a", Name: "A", Path: rootA}})}
	plan, err := planner.Plan(context.Background(), Request{Type: OpMkdir, DestRoot: "a", DestPath: ".", NewName: "new"})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "target_exists" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanTransferRejectsDestinationInsideSource(t *testing.T) {
	for _, operation := range []OperationType{OpMove, OpCopy} {
		for _, destination := range []string{"folder", "folder/child"} {
			t.Run(string(operation)+"/"+destination, func(t *testing.T) {
				root := t.TempDir()
				if err := os.MkdirAll(filepath.Join(root, "folder", "child"), 0o755); err != nil {
					t.Fatal(err)
				}
				planner := Planner{Resolver: roots.NewResolver([]roots.Root{{ID: "root", Name: "Root", Path: root}})}

				plan, err := planner.Plan(context.Background(), Request{
					Type: operation, SourceRoot: "root", Sources: []string{"folder"},
					DestRoot: "root", DestPath: destination,
				})
				if err != nil {
					t.Fatal(err)
				}
				if !plan.HasConflict || plan.Items[0].ErrorCode != "destination_inside_source" {
					t.Fatalf("plan = %+v", plan)
				}
			})
		}
	}
}

func TestPlanCopyRejectsOverlappingRootInsideSource(t *testing.T) {
	root := t.TempDir()
	destinationRoot := filepath.Join(root, "folder", "mounted-root")
	if err := os.MkdirAll(destinationRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	planner := Planner{Resolver: roots.NewResolver([]roots.Root{
		{ID: "source", Name: "Source", Path: root},
		{ID: "destination", Name: "Destination", Path: destinationRoot},
	})}

	plan, err := planner.Plan(context.Background(), Request{
		Type: OpCopy, SourceRoot: "source", Sources: []string{"folder"},
		DestRoot: "destination", DestPath: ".",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "destination_inside_source" {
		t.Fatalf("plan = %+v", plan)
	}
}

func TestPlanCopyRejectsSymlinkedDestinationInsideSource(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "folder", "child"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(root, "folder", "child"), filepath.Join(root, "nested-link")); err != nil {
		t.Fatal(err)
	}
	planner := Planner{Resolver: roots.NewResolver([]roots.Root{{ID: "root", Name: "Root", Path: root}})}

	plan, err := planner.Plan(context.Background(), Request{
		Type: OpCopy, SourceRoot: "root", Sources: []string{"folder"},
		DestRoot: "root", DestPath: "nested-link",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict || plan.Items[0].ErrorCode != "destination_inside_source" {
		t.Fatalf("plan = %+v", plan)
	}
}

func testResolver(rootA, rootB string) roots.Resolver {
	return roots.NewResolver([]roots.Root{
		{ID: "a", Name: "A", Path: rootA},
		{ID: "b", Name: "B", Path: rootB},
	})
}
