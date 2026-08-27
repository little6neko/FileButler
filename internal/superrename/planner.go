package superrename

import (
	"errors"
	"fmt"
)

var (
	ErrEmptySelection   = errors.New("superrename_empty_selection")
	ErrInvalidSelection = errors.New("superrename_invalid_selection")
	ErrStaleSelection   = errors.New("superrename_stale_selection")
	ErrPlanConflict     = errors.New("superrename_plan_conflict")
)

type Planner struct{}

func (Planner) Build(inventory Inventory, selectedPaths []string) (Plan, error) {
	return BuildPlan(inventory, selectedPaths)
}

func BuildPlan(inventory Inventory, selectedPaths []string) (Plan, error) {
	if len(selectedPaths) == 0 {
		return Plan{}, ErrEmptySelection
	}

	candidates := make(map[string]struct{})
	for _, group := range inventory.Groups {
		for _, candidate := range group.Images {
			candidates[candidate.SourcePath] = struct{}{}
		}
		for _, candidate := range group.Videos {
			candidates[candidate.SourcePath] = struct{}{}
		}
	}
	selected := make(map[string]struct{}, len(selectedPaths))
	for _, sourcePath := range selectedPaths {
		if sourcePath == "" {
			return Plan{}, fmt.Errorf("%w: empty path", ErrInvalidSelection)
		}
		if _, duplicate := selected[sourcePath]; duplicate {
			return Plan{}, fmt.Errorf("%w: duplicate path %q", ErrInvalidSelection, sourcePath)
		}
		if _, exists := candidates[sourcePath]; !exists {
			return Plan{}, fmt.Errorf("%w: %s", ErrStaleSelection, sourcePath)
		}
		selected[sourcePath] = struct{}{}
	}

	plan := Plan{
		RootID:        inventory.RootID,
		DirectoryPath: inventory.DirectoryPath,
		Groups:        []PlanGroup{},
		Summary: PlanSummary{
			GroupCount:    len(inventory.Groups),
			SelectedCount: len(selectedPaths),
		},
	}
	for _, group := range inventory.Groups {
		if len(group.Images)+len(group.Videos) > 0 {
			plan.Summary.MatchedGroupCount++
		}
		plan.Summary.UnmatchedCount += len(group.Unmatched)

		imageRows := ProjectCandidates(group.Path, MediaKindImage, group.Images, selected)
		videoRows := ProjectCandidates(group.Path, MediaKindVideo, group.Videos, selected)
		items := make([]PlanItem, 0, len(imageRows)+len(videoRows))
		selectedVideos := 0
		for _, row := range imageRows {
			if row.Selected {
				items = append(items, planItemFromProjection(row))
			}
		}
		for _, row := range videoRows {
			if row.Selected {
				selectedVideos++
				items = append(items, planItemFromProjection(row))
			}
		}
		if len(items) == 0 {
			continue
		}

		plannedGroup := PlanGroup{
			Path:                 group.Path,
			Name:                 group.Name,
			Items:                items,
			CreateVideoDirectory: selectedVideos > 0 && group.VideoDirectory.Status == VideoDirectoryMissing,
		}
		markGroupConflicts(group, &plannedGroup)
		for _, item := range plannedGroup.Items {
			if item.Conflict {
				plannedGroup.HasConflict = true
				plan.HasConflict = true
				plan.Summary.ConflictCount++
			}
		}
		if plannedGroup.CreateVideoDirectory {
			plan.Summary.CreateVideoDirectoryCount++
		}
		plan.Groups = append(plan.Groups, plannedGroup)
	}
	return plan, nil
}

func planItemFromProjection(row ProjectedCandidate) PlanItem {
	return PlanItem{
		SourcePath: row.SourcePath,
		SourceName: row.Name,
		TargetPath: row.TargetPath,
		TargetName: row.TargetName,
		Extension:  row.Extension,
		MediaKind:  row.MediaKind,
		Changed:    row.Changed,
	}
}

func markGroupConflicts(inventory InventoryGroup, plan *PlanGroup) {
	if len(inventory.RecoveryResidues) > 0 {
		for index := range plan.Items {
			setConflict(&plan.Items[index], ConflictRecoveryRequired, "unfinished SuperRename recovery data is present")
		}
		return
	}

	sourceIndexes := make(map[string]int, len(plan.Items))
	targetIndexes := make(map[string][]int, len(plan.Items))
	for index, item := range plan.Items {
		sourceIndexes[item.SourcePath] = index
		targetIndexes[item.TargetPath] = append(targetIndexes[item.TargetPath], index)
	}
	for _, indexes := range targetIndexes {
		if len(indexes) < 2 {
			continue
		}
		for _, index := range indexes {
			setConflict(&plan.Items[index], ConflictDuplicateTarget, "multiple selected files have the same target")
		}
	}

	occupied := make(map[string]struct{}, len(inventory.DirectOccupiedPaths)+len(inventory.VideoDirectory.OccupiedPaths))
	for _, occupiedPath := range inventory.DirectOccupiedPaths {
		occupied[occupiedPath] = struct{}{}
	}
	for _, occupiedPath := range inventory.VideoDirectory.OccupiedPaths {
		occupied[occupiedPath] = struct{}{}
	}

	for index := range plan.Items {
		item := &plan.Items[index]
		if item.Conflict {
			continue
		}
		if item.MediaKind == MediaKindVideo && inventory.VideoDirectory.Status == VideoDirectoryBlockingEntry {
			setConflict(item, ConflictVideoDirectoryBlocked, "the video path exists and is not a directory")
			continue
		}
		if item.TargetPath == item.SourcePath {
			continue
		}
		if _, exists := occupied[item.TargetPath]; !exists {
			continue
		}
		occupantIndex, selectedOccupant := sourceIndexes[item.TargetPath]
		if selectedOccupant && plan.Items[occupantIndex].TargetPath != plan.Items[occupantIndex].SourcePath {
			continue
		}
		setConflict(item, ConflictTargetOccupied, "the target path is occupied by an item that will not move")
	}
}

func setConflict(item *PlanItem, code ConflictCode, text string) {
	item.Conflict = true
	item.ErrorCode = code
	item.ErrorText = text
}
