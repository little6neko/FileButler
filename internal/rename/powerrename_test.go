package rename

import "testing"

func TestPowerRenamePlanUsesRegexTokensAndTransforms(t *testing.T) {
	opts := PowerRenameOptions{
		Search:         `file(\d+)`,
		Replace:        "photo-$1-${padding=2}",
		UseRegex:       true,
		MatchAll:       false,
		NameOnly:       true,
		Uppercase:      true,
		EnumerateItems: true,
	}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "file12.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) != 1 || plan.Items[0].NewName != "PHOTO-12-01.txt" {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPowerRenamePlanRendersEnumerationTokenInRegexReplacement(t *testing.T) {
	opts := PowerRenameOptions{
		Search:   `^.*`,
		Replace:  `V${start=1, padding=2}`,
		UseRegex: true,
		MatchAll: false,
		NameOnly: true,
	}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "file12.txt"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) != 1 || plan.Items[0].NewName != "V01.txt" {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPowerRenamePlanExtensionOnly(t *testing.T) {
	opts := PowerRenameOptions{Search: "jpeg", Replace: "jpg", MatchAll: false, ExtensionOnly: true}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "photo.jpeg"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].NewName != "photo.jpg" {
		t.Fatalf("new name=%q", plan.Items[0].NewName)
	}
}

func TestPowerRenamePlanExcludesFolders(t *testing.T) {
	opts := PowerRenameOptions{Search: "a", Replace: "b", ExcludeFolders: true}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "a.txt"}, {RelativePath: "a-folder", IsDir: true}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Items) != 1 || plan.Items[0].SourcePath != "a.txt" {
		t.Fatalf("items=%+v", plan.Items)
	}
}
