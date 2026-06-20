package rename

import (
	"bytes"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/little6neko/filebutler/internal/natsort"
)

func Plan(items []InputItem, opts Options, existingTarget func(path string) bool) (PlanResult, error) {
	if opts.Target == "" {
		opts.Target = TargetName
	}
	filtered := make([]InputItem, 0, len(items))
	for _, item := range items {
		if item.IsDir && !opts.IncludeDirs {
			continue
		}
		if !item.IsDir && !opts.IncludeFiles {
			continue
		}
		filtered = append(filtered, item)
	}
	sort.SliceStable(filtered, func(i, j int) bool {
		bi := filepath.Base(filtered[i].RelativePath)
		bj := filepath.Base(filtered[j].RelativePath)
		if bi != bj {
			return natsort.Less(bi, bj)
		}
		return filtered[i].RelativePath < filtered[j].RelativePath
	})

	var rx *regexp.Regexp
	var err error
	if opts.UseRegex {
		pattern := opts.Search
		if !opts.CaseSensitive {
			pattern = "(?i)" + pattern
		}
		rx, err = regexp.Compile(pattern)
		if err != nil {
			return PlanResult{}, err
		}
	}

	result := PlanResult{Items: make([]PlanItem, 0, len(filtered))}
	targetIndexes := map[string][]int{}
	for i, item := range filtered {
		dir := filepath.Dir(item.RelativePath)
		if dir == "." {
			dir = ""
		}
		oldName := filepath.Base(item.RelativePath)
		newName := renameBase(oldName, opts, rx)
		if opts.Enumerate {
			newName = enumerateName(newName, opts.Target, i+1)
		}
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

func renameBase(base string, opts Options, rx *regexp.Regexp) string {
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)
	extNoDot := strings.TrimPrefix(ext, ".")
	switch opts.Target {
	case TargetExtension:
		replaced := replacePart(extNoDot, opts, rx)
		if replaced == "" {
			return name
		}
		return name + "." + replaced
	case TargetBoth:
		return replacePart(base, opts, rx)
	default:
		return replacePart(name, opts, rx) + ext
	}
}

func replacePart(input string, opts Options, rx *regexp.Regexp) string {
	if opts.Search == "" {
		return input
	}
	if opts.UseRegex {
		return replaceRegex(input, opts, rx)
	}
	if opts.CaseSensitive {
		if opts.MatchAll {
			return strings.ReplaceAll(input, opts.Search, opts.Replace)
		}
		return strings.Replace(input, opts.Search, opts.Replace, 1)
	}
	lowerInput := strings.ToLower(input)
	lowerSearch := strings.ToLower(opts.Search)
	if opts.MatchAll {
		var b strings.Builder
		for {
			idx := strings.Index(lowerInput, lowerSearch)
			if idx < 0 {
				b.WriteString(input)
				break
			}
			b.WriteString(input[:idx])
			b.WriteString(opts.Replace)
			input = input[idx+len(opts.Search):]
			lowerInput = lowerInput[idx+len(opts.Search):]
		}
		return b.String()
	}
	idx := strings.Index(lowerInput, lowerSearch)
	if idx < 0 {
		return input
	}
	return input[:idx] + opts.Replace + input[idx+len(opts.Search):]
}

func replaceRegex(input string, opts Options, rx *regexp.Regexp) string {
	if rx == nil {
		return input
	}
	matches := rx.FindAllStringSubmatchIndex(input, -1)
	if len(matches) == 0 {
		return input
	}
	if !opts.MatchAll {
		matches = matches[:1]
	}
	var out bytes.Buffer
	last := 0
	for _, match := range matches {
		out.WriteString(input[last:match[0]])
		out.Write(rx.ExpandString(nil, opts.Replace, input, match))
		last = match[1]
	}
	out.WriteString(input[last:])
	return out.String()
}

func enumerateName(base string, target TargetPart, index int) string {
	suffix := " (" + strconvItoa(index) + ")"
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)
	if target == TargetExtension {
		extNoDot := strings.TrimPrefix(ext, ".")
		if extNoDot == "" {
			return base + suffix
		}
		return name + "." + extNoDot + suffix
	}
	return name + suffix + ext
}

func strconvItoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
