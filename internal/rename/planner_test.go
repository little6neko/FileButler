package rename

import "testing"

func TestPlanPlainReplaceFirstOccurrence(t *testing.T) {
	plan, err := Plan([]InputItem{{RelativePath: "file-file.txt"}}, baseOptions("file", "doc"), nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "doc-file.txt" {
		t.Fatalf("new name = %q", plan.Items[0].NewName)
	}
}

func TestPlanPlainReplaceAllOccurrences(t *testing.T) {
	opts := baseOptions("file", "doc")
	opts.MatchAll = true
	plan, err := Plan([]InputItem{{RelativePath: "file-file.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "doc-doc.txt" {
		t.Fatalf("new name = %q", plan.Items[0].NewName)
	}
}

func TestPlanCaseInsensitiveReplace(t *testing.T) {
	opts := baseOptions("file", "doc")
	opts.CaseSensitive = false
	plan, err := Plan([]InputItem{{RelativePath: "File.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "doc.txt" {
		t.Fatalf("new name = %q", plan.Items[0].NewName)
	}
}

func TestPlanRegexReplaceWithCapture(t *testing.T) {
	opts := baseOptions(`file(\d+)`, "doc$1")
	opts.UseRegex = true
	plan, err := Plan([]InputItem{{RelativePath: "file12.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "doc12.txt" {
		t.Fatalf("new name = %q", plan.Items[0].NewName)
	}
}

func TestPlanApplyToExtensionOnly(t *testing.T) {
	opts := baseOptions("jpeg", "jpg")
	opts.Target = TargetExtension
	plan, err := Plan([]InputItem{{RelativePath: "photo.jpeg"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "photo.jpg" {
		t.Fatalf("new name = %q", plan.Items[0].NewName)
	}
}

func TestPlanEnumerateUsesNaturalOrder(t *testing.T) {
	opts := baseOptions("file", "photo")
	opts.Enumerate = true
	items := []InputItem{{RelativePath: "file100.txt"}, {RelativePath: "file02.txt"}, {RelativePath: "file2.txt"}}
	plan, err := Plan(items, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"photo2 (1).txt", "photo02 (2).txt", "photo100 (3).txt"}
	for i := range want {
		if plan.Items[i].NewName != want[i] {
			t.Fatalf("item %d new name = %q, want %q", i, plan.Items[i].NewName, want[i])
		}
	}
}

func TestPlanDetectsDuplicateTargets(t *testing.T) {
	opts := baseOptions("a", "x")
	opts.MatchAll = true
	plan, err := Plan([]InputItem{{RelativePath: "a.txt"}, {RelativePath: "x.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.HasConflict {
		t.Fatal("expected conflict")
	}
	if plan.Items[0].ErrorCode != "duplicate_target" || plan.Items[1].ErrorCode != "duplicate_target" {
		t.Fatalf("items = %+v", plan.Items)
	}
}

func TestPlanSkipsFilesAndDirectoriesByOptions(t *testing.T) {
	opts := baseOptions("a", "b")
	opts.IncludeFiles = false
	opts.IncludeDirs = true
	plan, err := Plan([]InputItem{{RelativePath: "a.txt"}, {RelativePath: "a-dir", IsDir: true}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) != 1 || plan.Items[0].SourcePath != "a-dir" {
		t.Fatalf("items = %+v", plan.Items)
	}
}

func baseOptions(search, replace string) Options {
	return Options{
		Search:       search,
		Replace:      replace,
		Target:       TargetName,
		IncludeFiles: true,
		IncludeDirs:  true,
	}
}
