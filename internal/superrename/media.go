package superrename

import (
	"fmt"
	"path"
	"strings"
)

var imageExtensions = map[string]struct{}{
	".avif": {},
	".bmp":  {},
	".gif":  {},
	".jpeg": {},
	".jpg":  {},
	".png":  {},
	".svg":  {},
	".webp": {},
}

var videoExtensions = map[string]struct{}{
	".m4v":  {},
	".mkv":  {},
	".mov":  {},
	".mp4":  {},
	".ogg":  {},
	".ogv":  {},
	".webm": {},
}

func ClassifyMedia(name string) (MediaKind, string, bool) {
	extension := path.Ext(name)
	normalized := strings.ToLower(extension)
	if _, ok := imageExtensions[normalized]; ok {
		return MediaKindImage, extension, true
	}
	if _, ok := videoExtensions[normalized]; ok {
		return MediaKindVideo, extension, true
	}
	return "", extension, false
}

func SequencePadding(count int) int {
	padding := 2
	for count >= 100 {
		padding++
		count /= 10
	}
	return padding
}

func ProjectCandidates(groupPath string, kind MediaKind, candidates []Candidate, selected map[string]struct{}) []ProjectedCandidate {
	selectedCount := 0
	for _, candidate := range candidates {
		if _, ok := selected[candidate.SourcePath]; ok {
			selectedCount++
		}
	}

	padding := SequencePadding(selectedCount)
	rows := make([]ProjectedCandidate, 0, len(candidates))
	sequence := 0
	for _, candidate := range candidates {
		row := ProjectedCandidate{Candidate: candidate}
		if _, ok := selected[candidate.SourcePath]; !ok {
			rows = append(rows, row)
			continue
		}
		sequence++
		prefix := ""
		if kind == MediaKindVideo {
			prefix = "V"
		}
		row.Selected = true
		row.TargetName = fmt.Sprintf("%s%0*d%s", prefix, padding, sequence, candidate.Extension)
		if kind == MediaKindVideo {
			row.TargetPath = joinRelative(groupPath, "视频", row.TargetName)
		} else {
			row.TargetPath = joinRelative(groupPath, row.TargetName)
		}
		row.Changed = row.TargetPath != candidate.SourcePath
		rows = append(rows, row)
	}
	return rows
}

func joinRelative(parts ...string) string {
	joined := path.Join(parts...)
	if joined == "." {
		return ""
	}
	return joined
}
