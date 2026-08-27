package superrename

import (
	"errors"
	"reflect"
	"testing"
)

func TestBuildPlanNumbersEachGroupAndMediaKindIndependently(t *testing.T) {
	inventory := Inventory{
		RootID:        "media",
		DirectoryPath: "albums",
		Groups: []InventoryGroup{
			{
				Path:   "albums/A",
				Name:   "A",
				Images: []Candidate{image("albums/A/image2.JPG"), image("albums/A/image10.png")},
				Videos: []Candidate{video("albums/A/clip2.MKV"), video("albums/A/clip10.mp4")},
				Unmatched: []Unmatched{
					{Path: "albums/A/notes.txt", Name: "notes.txt", Kind: EntryKindFile, Reason: UnmatchedUnsupportedExtension},
				},
				DirectOccupiedPaths: []string{
					"albums/A/image2.JPG", "albums/A/image10.png", "albums/A/clip2.MKV", "albums/A/clip10.mp4", "albums/A/notes.txt",
				},
				VideoDirectory: VideoDirectory{Status: VideoDirectoryMissing, Path: "albums/A/视频", OccupiedPaths: []string{}},
			},
			{
				Path:                "albums/B",
				Name:                "B",
				Images:              []Candidate{},
				Videos:              []Candidate{},
				Unmatched:           []Unmatched{{Path: "albums/B/readme", Name: "readme", Kind: EntryKindFile, Reason: UnmatchedUnsupportedExtension}},
				VideoDirectory:      VideoDirectory{Status: VideoDirectoryMissing, Path: "albums/B/视频", OccupiedPaths: []string{}},
				RecoveryResidues:    []string{},
				DirectOccupiedPaths: []string{"albums/B/readme"},
			},
		},
	}
	selected := []string{
		"albums/A/image2.JPG",
		"albums/A/image10.png",
		"albums/A/clip2.MKV",
		"albums/A/clip10.mp4",
	}

	plan, err := BuildPlan(inventory, selected)
	if err != nil {
		t.Fatal(err)
	}
	if plan.HasConflict {
		t.Fatalf("unexpected conflict: %+v", plan)
	}
	if len(plan.Groups) != 1 || !plan.Groups[0].CreateVideoDirectory {
		t.Fatalf("groups = %+v", plan.Groups)
	}
	if got := planTargets(plan.Groups[0].Items); !reflect.DeepEqual(got, []string{
		"albums/A/01.JPG",
		"albums/A/02.png",
		"albums/A/视频/V01.MKV",
		"albums/A/视频/V02.mp4",
	}) {
		t.Fatalf("targets = %v", got)
	}
	wantSummary := PlanSummary{
		GroupCount:                2,
		MatchedGroupCount:         1,
		SelectedCount:             4,
		UnmatchedCount:            2,
		CreateVideoDirectoryCount: 1,
	}
	if plan.Summary != wantSummary {
		t.Fatalf("summary = %+v, want %+v", plan.Summary, wantSummary)
	}
}

func TestBuildPlanAllowsTargetOccupiedBySelectedSourceThatWillVacate(t *testing.T) {
	group := baseInventoryGroup("albums/A")
	group.Images = []Candidate{image("albums/A/02.jpg"), image("albums/A/a.jpg")}
	group.DirectOccupiedPaths = []string{"albums/A/02.jpg", "albums/A/a.jpg"}
	inventory := Inventory{RootID: "media", DirectoryPath: "albums", Groups: []InventoryGroup{group}}

	plan, err := BuildPlan(inventory, []string{"albums/A/02.jpg", "albums/A/a.jpg"})
	if err != nil {
		t.Fatal(err)
	}
	if plan.HasConflict {
		t.Fatalf("unexpected conflict: %+v", plan.Groups[0].Items)
	}
	if got := planTargets(plan.Groups[0].Items); !reflect.DeepEqual(got, []string{"albums/A/01.jpg", "albums/A/02.jpg"}) {
		t.Fatalf("targets = %v", got)
	}
}

func TestBuildPlanRejectsTargetOccupiedByUnselectedCandidate(t *testing.T) {
	group := baseInventoryGroup("albums/A")
	group.Images = []Candidate{image("albums/A/01.jpg"), image("albums/A/a.jpg")}
	group.DirectOccupiedPaths = []string{"albums/A/01.jpg", "albums/A/a.jpg"}
	inventory := Inventory{RootID: "media", DirectoryPath: "albums", Groups: []InventoryGroup{group}}

	plan, err := BuildPlan(inventory, []string{"albums/A/a.jpg"})
	if err != nil {
		t.Fatal(err)
	}
	item := plan.Groups[0].Items[0]
	if !plan.HasConflict || !item.Conflict || item.ErrorCode != ConflictTargetOccupied {
		t.Fatalf("item = %+v, plan conflict = %t", item, plan.HasConflict)
	}
}

func TestBuildPlanDetectsVideoContainerConflicts(t *testing.T) {
	tests := []struct {
		name       string
		directory  VideoDirectory
		wantCode   ConflictCode
		wantCreate bool
	}{
		{
			name: "occupied target",
			directory: VideoDirectory{
				Status:        VideoDirectoryPresent,
				Path:          "albums/A/视频",
				OccupiedPaths: []string{"albums/A/视频/V01.mp4"},
			},
			wantCode: ConflictTargetOccupied,
		},
		{
			name:       "blocking entry",
			directory:  VideoDirectory{Status: VideoDirectoryBlockingEntry, Path: "albums/A/视频", OccupiedPaths: []string{}},
			wantCode:   ConflictVideoDirectoryBlocked,
			wantCreate: false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			group := baseInventoryGroup("albums/A")
			group.Videos = []Candidate{video("albums/A/clip.mp4")}
			group.DirectOccupiedPaths = []string{"albums/A/clip.mp4"}
			group.VideoDirectory = test.directory
			inventory := Inventory{RootID: "media", DirectoryPath: "albums", Groups: []InventoryGroup{group}}

			plan, err := BuildPlan(inventory, []string{"albums/A/clip.mp4"})
			if err != nil {
				t.Fatal(err)
			}
			item := plan.Groups[0].Items[0]
			if !item.Conflict || item.ErrorCode != test.wantCode {
				t.Fatalf("item = %+v, want conflict %q", item, test.wantCode)
			}
			if plan.Groups[0].CreateVideoDirectory != test.wantCreate {
				t.Fatalf("create video directory = %t, want %t", plan.Groups[0].CreateVideoDirectory, test.wantCreate)
			}
		})
	}
}

func TestBuildPlanMakesRecoveryResidueBlockEverySelectedItemInGroup(t *testing.T) {
	group := baseInventoryGroup("albums/A")
	group.Images = []Candidate{image("albums/A/a.jpg")}
	group.Videos = []Candidate{video("albums/A/b.mp4")}
	group.DirectOccupiedPaths = []string{"albums/A/a.jpg", "albums/A/b.mp4", "albums/A/.filebutler-superrename-old"}
	group.RecoveryResidues = []string{"albums/A/.filebutler-superrename-old"}
	inventory := Inventory{RootID: "media", DirectoryPath: "albums", Groups: []InventoryGroup{group}}

	plan, err := BuildPlan(inventory, []string{"albums/A/a.jpg", "albums/A/b.mp4"})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range plan.Groups[0].Items {
		if !item.Conflict || item.ErrorCode != ConflictRecoveryRequired {
			t.Fatalf("item = %+v", item)
		}
	}
}

func TestBuildPlanValidatesSelectedPaths(t *testing.T) {
	group := baseInventoryGroup("albums/A")
	group.Images = []Candidate{image("albums/A/a.jpg")}
	inventory := Inventory{RootID: "media", DirectoryPath: "albums", Groups: []InventoryGroup{group}}

	tests := []struct {
		name     string
		selected []string
		want     error
	}{
		{name: "empty", selected: nil, want: ErrEmptySelection},
		{name: "duplicate", selected: []string{"albums/A/a.jpg", "albums/A/a.jpg"}, want: ErrInvalidSelection},
		{name: "stale", selected: []string{"albums/A/missing.jpg"}, want: ErrStaleSelection},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := BuildPlan(inventory, test.selected)
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
		})
	}
}

func image(sourcePath string) Candidate {
	_, extension, _ := ClassifyMedia(sourcePath)
	return Candidate{SourcePath: sourcePath, Name: filepathBase(sourcePath), Extension: extension, MediaKind: MediaKindImage}
}

func video(sourcePath string) Candidate {
	_, extension, _ := ClassifyMedia(sourcePath)
	return Candidate{SourcePath: sourcePath, Name: filepathBase(sourcePath), Extension: extension, MediaKind: MediaKindVideo}
}

func baseInventoryGroup(groupPath string) InventoryGroup {
	return InventoryGroup{
		Path:                groupPath,
		Name:                filepathBase(groupPath),
		Images:              []Candidate{},
		Videos:              []Candidate{},
		Unmatched:           []Unmatched{},
		DirectOccupiedPaths: []string{},
		VideoDirectory:      VideoDirectory{Status: VideoDirectoryMissing, Path: groupPath + "/视频", OccupiedPaths: []string{}},
		RecoveryResidues:    []string{},
	}
}

func filepathBase(value string) string {
	for index := len(value) - 1; index >= 0; index-- {
		if value[index] == '/' {
			return value[index+1:]
		}
	}
	return value
}

func planTargets(items []PlanItem) []string {
	targets := make([]string, len(items))
	for index, item := range items {
		targets[index] = item.TargetPath
	}
	return targets
}
