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

func TestPowerRenamePlanNameOnlyMatchesDottedStem(t *testing.T) {
	opts := PowerRenameOptions{Search: "V1.test", Replace: "V2", MatchAll: false, NameOnly: true}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "V1.test.mp4"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !plan.Items[0].Changed || plan.Items[0].NewName != "V2.mp4" {
		t.Fatalf("plan=%+v", plan)
	}
}

func TestPowerRenamePlanNameOnlyDoesNotMatchExtension(t *testing.T) {
	opts := PowerRenameOptions{Search: "V1.test.mp4", Replace: "V2", MatchAll: false, NameOnly: true}
	plan, err := PowerRenamePlan([]InputItem{{RelativePath: "V1.test.mp4"}}, opts, nil)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Items[0].Changed || plan.Items[0].NewName != "V1.test.mp4" {
		t.Fatalf("plan=%+v", plan)
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

func TestPowerRenamePlanSkipsFileMetadataContextForPlainPreview(t *testing.T) {
	original := powerRenameTemplateContextBuilder
	called := false
	powerRenameTemplateContextBuilder = func(string, powerRenameTemplateContextMode) PowerRenameTemplateContext {
		called = true
		return PowerRenameTemplateContext{}
	}
	t.Cleanup(func() { powerRenameTemplateContextBuilder = original })

	_, err := PowerRenamePlan([]InputItem{{RelativePath: "clip01.mp4", AbsPath: "/tmp/clip01.mp4"}}, PowerRenameOptions{NameOnly: true}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("plain preview should not read file metadata")
	}
}

func TestPowerRenamePlanSkipsFileMetadataContextForEnumerationToken(t *testing.T) {
	original := powerRenameTemplateContextBuilder
	called := false
	powerRenameTemplateContextBuilder = func(string, powerRenameTemplateContextMode) PowerRenameTemplateContext {
		called = true
		return PowerRenameTemplateContext{}
	}
	t.Cleanup(func() { powerRenameTemplateContextBuilder = original })

	_, err := PowerRenamePlan(
		[]InputItem{{RelativePath: "clip01.mp4", AbsPath: "/tmp/clip01.mp4"}},
		PowerRenameOptions{Search: `^.*`, Replace: `V${start=1, padding=2}`, UseRegex: true, NameOnly: true},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Fatal("enumeration token preview should not read file metadata")
	}
}

func TestPowerRenamePlanBuildsFileMetadataContextForMetadataToken(t *testing.T) {
	original := powerRenameTemplateContextBuilder
	var gotMode powerRenameTemplateContextMode
	powerRenameTemplateContextBuilder = func(_ string, mode powerRenameTemplateContextMode) PowerRenameTemplateContext {
		gotMode = mode
		return PowerRenameTemplateContext{Metadata: map[string]string{"CAMERA_MODEL": "X100"}}
	}
	t.Cleanup(func() { powerRenameTemplateContextBuilder = original })

	plan, err := PowerRenamePlan(
		[]InputItem{{RelativePath: "photo.jpg", AbsPath: "/tmp/photo.jpg"}},
		PowerRenameOptions{Search: `^.*`, Replace: `${CAMERA_MODEL}`, UseRegex: true, NameOnly: true},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if gotMode&powerRenameTemplateContextMetadata == 0 {
		t.Fatalf("expected metadata context mode, got %v", gotMode)
	}
	if plan.Items[0].NewName != "X100.jpg" {
		t.Fatalf("plan=%+v", plan)
	}
}
