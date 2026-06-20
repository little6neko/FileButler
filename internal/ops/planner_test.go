package ops

import (
	"context"
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

func testResolver(rootA, rootB string) roots.Resolver {
	return roots.NewResolver([]roots.Root{
		{ID: "a", Name: "A", Path: rootA},
		{ID: "b", Name: "B", Path: rootB},
	})
}
