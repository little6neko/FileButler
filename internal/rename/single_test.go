package rename

import "testing"

func TestSingleRenamePlanRejectsMultiplePaths(t *testing.T) {
	_, err := BuildSinglePlan([]InputItem{{RelativePath: "a.txt"}, {RelativePath: "b.txt"}}, "next.txt", nil)
	if err == nil || err.Error() != "ordinary rename requires exactly one selected item" {
		t.Fatalf("err = %v", err)
	}
}

func TestSingleRenamePlanRejectsPathSeparators(t *testing.T) {
	_, err := BuildSinglePlan([]InputItem{{RelativePath: "a.txt"}}, "nested/b.txt", nil)
	if err == nil || err.Error() != "new name must not contain a path separator" {
		t.Fatalf("err = %v", err)
	}
}

func TestSingleRenamePlanBuildsOneItem(t *testing.T) {
	plan, err := BuildSinglePlan([]InputItem{{RelativePath: "folder/a.txt"}}, "b.txt", func(path string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	if plan.HasConflict || len(plan.Items) != 1 {
		t.Fatalf("plan = %+v", plan)
	}
	item := plan.Items[0]
	if item.SourcePath != "folder/a.txt" || item.TargetPath != "folder/b.txt" || item.OldName != "a.txt" || item.NewName != "b.txt" || !item.Changed {
		t.Fatalf("item = %+v", item)
	}
}
