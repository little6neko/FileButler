package superrename

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type plannerFixture struct {
	ClassificationCases []struct {
		Name      string     `json:"name"`
		Kind      *MediaKind `json:"kind"`
		Extension string     `json:"extension"`
	} `json:"classificationCases"`
	PaddingCases []struct {
		Count   int `json:"count"`
		Padding int `json:"padding"`
	} `json:"paddingCases"`
	ProjectionCases []struct {
		Name          string      `json:"name"`
		GroupPath     string      `json:"groupPath"`
		Kind          MediaKind   `json:"kind"`
		Candidates    []Candidate `json:"candidates"`
		SelectedPaths []string    `json:"selectedPaths"`
		Targets       []*string   `json:"targets"`
	} `json:"projectionCases"`
	PlanCases []struct {
		Name          string    `json:"name"`
		Inventory     Inventory `json:"inventory"`
		SelectedPaths []string  `json:"selectedPaths"`
		Items         []struct {
			SourcePath string        `json:"sourcePath"`
			TargetPath string        `json:"targetPath"`
			ErrorCode  *ConflictCode `json:"errorCode"`
		} `json:"items"`
	} `json:"planCases"`
}

func TestSharedPlannerFixture(t *testing.T) {
	fixture := loadPlannerFixture(t)

	for _, test := range fixture.ClassificationCases {
		kind, extension, matched := ClassifyMedia(test.Name)
		if extension != test.Extension {
			t.Errorf("ClassifyMedia(%q) extension = %q, want %q", test.Name, extension, test.Extension)
		}
		if test.Kind == nil {
			if matched {
				t.Errorf("ClassifyMedia(%q) matched as %q, want unmatched", test.Name, kind)
			}
			continue
		}
		if !matched || kind != *test.Kind {
			t.Errorf("ClassifyMedia(%q) = (%q, %t), want (%q, true)", test.Name, kind, matched, *test.Kind)
		}
	}

	for _, test := range fixture.PaddingCases {
		if got := SequencePadding(test.Count); got != test.Padding {
			t.Errorf("SequencePadding(%d) = %d, want %d", test.Count, got, test.Padding)
		}
	}

	for _, test := range fixture.ProjectionCases {
		t.Run(test.Name, func(t *testing.T) {
			selected := make(map[string]struct{}, len(test.SelectedPaths))
			for _, sourcePath := range test.SelectedPaths {
				selected[sourcePath] = struct{}{}
			}
			rows := ProjectCandidates(test.GroupPath, test.Kind, test.Candidates, selected)
			if len(rows) != len(test.Targets) {
				t.Fatalf("len(rows) = %d, want %d", len(rows), len(test.Targets))
			}
			for index, want := range test.Targets {
				if want == nil {
					if rows[index].Selected || rows[index].TargetPath != "" {
						t.Errorf("row %d = %+v, want unselected with no target", index, rows[index])
					}
					continue
				}
				if !rows[index].Selected || rows[index].TargetPath != *want {
					t.Errorf("row %d = %+v, want selected target %q", index, rows[index], *want)
				}
			}
		})
	}

	for _, test := range fixture.PlanCases {
		t.Run(test.Name, func(t *testing.T) {
			plan, err := BuildPlan(test.Inventory, test.SelectedPaths)
			if err != nil {
				t.Fatal(err)
			}
			items := make([]PlanItem, 0, len(test.Items))
			for _, group := range plan.Groups {
				items = append(items, group.Items...)
			}
			if len(items) != len(test.Items) {
				t.Fatalf("len(items) = %d, want %d", len(items), len(test.Items))
			}
			for index, want := range test.Items {
				got := items[index]
				if got.SourcePath != want.SourcePath || got.TargetPath != want.TargetPath {
					t.Errorf("item %d = %+v, want source %q target %q", index, got, want.SourcePath, want.TargetPath)
				}
				if want.ErrorCode == nil {
					if got.Conflict || got.ErrorCode != "" {
						t.Errorf("item %d conflict = (%t, %q), want none", index, got.Conflict, got.ErrorCode)
					}
				} else if !got.Conflict || got.ErrorCode != *want.ErrorCode {
					t.Errorf("item %d conflict = (%t, %q), want %q", index, got.Conflict, got.ErrorCode, *want.ErrorCode)
				}
			}
		})
	}
}

func loadPlannerFixture(t *testing.T) plannerFixture {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate fixture test")
	}
	path := filepath.Join(filepath.Dir(filename), "..", "..", "testdata", "superrename", "planner.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var fixture plannerFixture
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}
