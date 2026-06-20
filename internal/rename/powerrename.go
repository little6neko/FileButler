package rename

import (
	"path/filepath"
	"sort"
	"strings"

	"github.com/little6neko/filebutler/internal/natsort"
)

func PowerRenamePlan(items []InputItem, opts PowerRenameOptions, existingTarget func(path string) bool) (PlanResult, error) {
	filtered := filterPowerRenameItems(items, opts)
	sort.SliceStable(filtered, func(i, j int) bool {
		bi := filepath.Base(filtered[i].RelativePath)
		bj := filepath.Base(filtered[j].RelativePath)
		if bi != bj {
			return natsort.Less(bi, bj)
		}
		return filtered[i].RelativePath < filtered[j].RelativePath
	})
	result := PlanResult{Items: make([]PlanItem, 0, len(filtered))}
	targetIndexes := map[string][]int{}
	for i, item := range filtered {
		oldName := filepath.Base(item.RelativePath)
		newName, err := powerRenameName(oldName, opts, i+1)
		if err != nil {
			return PlanResult{}, err
		}
		if opts.LegacyAppendEnumeration {
			newName = enumerateName(newName, TargetName, i+1)
		}
		dir := filepath.Dir(item.RelativePath)
		if dir == "." {
			dir = ""
		}
		targetPath := newName
		if dir != "" {
			targetPath = filepath.ToSlash(filepath.Join(dir, newName))
		}
		planItem := PlanItem{SourcePath: item.RelativePath, TargetPath: targetPath, OldName: oldName, NewName: newName, Changed: oldName != newName}
		if strings.ContainsAny(newName, `/\`) {
			planItem.Conflict = true
			planItem.ErrorCode = "invalid_name"
			planItem.ErrorText = "generated name contains a path separator"
			result.HasConflict = true
		} else if existingTarget != nil && targetPath != item.RelativePath && existingTarget(targetPath) {
			planItem.Conflict = true
			planItem.ErrorCode = "target_exists"
			planItem.ErrorText = "target already exists"
			result.HasConflict = true
		}
		targetIndexes[targetPath] = append(targetIndexes[targetPath], len(result.Items))
		result.Items = append(result.Items, planItem)
	}
	for _, indexes := range targetIndexes {
		if len(indexes) < 2 {
			continue
		}
		result.HasConflict = true
		for _, idx := range indexes {
			result.Items[idx].Conflict = true
			result.Items[idx].ErrorCode = "duplicate_target"
			result.Items[idx].ErrorText = "another item in this batch has the same target"
		}
	}
	return result, nil
}

func filterPowerRenameItems(items []InputItem, opts PowerRenameOptions) []InputItem {
	out := make([]InputItem, 0, len(items))
	for _, item := range items {
		if item.IsDir && opts.ExcludeFolders {
			continue
		}
		if !item.IsDir && opts.ExcludeFiles {
			continue
		}
		out = append(out, item)
	}
	return out
}

func powerRenameName(base string, opts PowerRenameOptions, itemIndex int) (string, error) {
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)
	extNoDot := strings.TrimPrefix(ext, ".")
	switch {
	case opts.ExtensionOnly:
		next, err := powerRenamePart(extNoDot, opts, itemIndex)
		if err != nil {
			return "", err
		}
		if next == "" {
			return name, nil
		}
		return name + "." + next, nil
	case opts.NameOnly:
		next, err := powerRenamePart(name, opts, itemIndex)
		if err != nil {
			return "", err
		}
		return next + ext, nil
	default:
		return powerRenamePart(base, opts, itemIndex)
	}
}

func powerRenamePart(input string, opts PowerRenameOptions, itemIndex int) (string, error) {
	replace := opts.Replace
	if opts.TemplateContext.Metadata != nil || !opts.TemplateContext.CreationTime.IsZero() || !opts.TemplateContext.ModifiedTime.IsZero() || !opts.TemplateContext.AccessTime.IsZero() {
		replace = renderPowerRenameMetadataTemplates(replace, opts.TemplateContext)
	}
	if opts.EnumerateItems || opts.RandomizeItems {
		rendered, _, err := renderPowerRenameTokens(replace, itemIndex, cryptoPowerRenameRandom{})
		if err != nil {
			return "", err
		}
		replace = rendered
	}
	var out string
	var err error
	if opts.Search == "" {
		out = input
	} else if opts.UseRegex {
		out, _, err = powerRenameRegexReplace(input, opts.Search, replace, PowerRenameRegexOptions{MatchAll: opts.MatchAll, CaseSensitive: opts.CaseSensitive})
		if err != nil {
			return "", err
		}
	} else {
		out = powerRenamePlainReplace(input, opts.Search, replace, opts.MatchAll, opts.CaseSensitive)
	}
	return applyPowerRenameTransforms(out, opts), nil
}

func powerRenamePlainReplace(input, search, replace string, matchAll bool, caseSensitive bool) string {
	if search == "" {
		return input
	}
	source := input
	needle := search
	if !caseSensitive {
		source = strings.ToLower(source)
		needle = strings.ToLower(needle)
	}
	if !matchAll {
		idx := strings.Index(source, needle)
		if idx < 0 {
			return input
		}
		return input[:idx] + replace + input[idx+len(search):]
	}
	var b strings.Builder
	for {
		idx := strings.Index(source, needle)
		if idx < 0 {
			b.WriteString(input)
			break
		}
		b.WriteString(input[:idx])
		b.WriteString(replace)
		input = input[idx+len(search):]
		source = source[idx+len(search):]
	}
	return b.String()
}

func applyPowerRenameTransforms(input string, opts PowerRenameOptions) string {
	switch {
	case opts.Uppercase:
		return powerRenameUppercase(input)
	case opts.Lowercase:
		return powerRenameLowercase(input)
	case opts.Titlecase:
		return powerRenameTitlecase(input)
	case opts.Capitalized:
		return powerRenameCapitalized(input)
	default:
		return input
	}
}
