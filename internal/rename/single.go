package rename

import (
	"errors"
	"path/filepath"
	"strings"
)

var ErrSingleRenameSelection = errors.New("ordinary rename requires exactly one selected item")
var ErrSingleRenameEmptyName = errors.New("new name must not be empty")
var ErrSingleRenamePathSeparator = errors.New("new name must not contain a path separator")

func BuildSinglePlan(items []InputItem, newName string, existingTarget func(path string) bool) (PlanResult, error) {
	if len(items) != 1 {
		return PlanResult{}, ErrSingleRenameSelection
	}
	newName = strings.TrimSpace(newName)
	if newName == "" {
		return PlanResult{}, ErrSingleRenameEmptyName
	}
	if strings.ContainsAny(newName, `/\`) {
		return PlanResult{}, ErrSingleRenamePathSeparator
	}
	item := items[0]
	dir := filepath.Dir(item.RelativePath)
	if dir == "." {
		dir = ""
	}
	oldName := filepath.Base(item.RelativePath)
	targetPath := newName
	if dir != "" {
		targetPath = filepath.ToSlash(filepath.Join(dir, newName))
	}
	planItem := PlanItem{
		SourcePath: item.RelativePath,
		TargetPath: targetPath,
		OldName:    oldName,
		NewName:    newName,
		Changed:    oldName != newName,
	}
	result := PlanResult{Items: []PlanItem{planItem}}
	if existingTarget != nil && targetPath != item.RelativePath && existingTarget(targetPath) {
		result.HasConflict = true
		result.Items[0].Conflict = true
		result.Items[0].ErrorCode = "target_exists"
		result.Items[0].ErrorText = "target already exists"
	}
	return result, nil
}
