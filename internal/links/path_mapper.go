package links

import (
	"fmt"
	"path/filepath"
	"strings"
)

type SymlinkMapping struct {
	Kind           LinkMappingKind
	OriginalTarget string
	LexicalTarget  string
	FinalTarget    string
	TargetText     string
}

type PathMapper struct {
	sourceAbs      string
	sourceAliasAbs string
	destAbs        string
}

func NewPathMapper(sourceAbs string, sourceAliasAbs string, destAbs string) PathMapper {
	return PathMapper{
		sourceAbs:      filepath.Clean(sourceAbs),
		sourceAliasAbs: filepath.Clean(sourceAliasAbs),
		destAbs:        filepath.Clean(destAbs),
	}
}

func (mapper PathMapper) Map(sourceLinkAbs string, destLinkAbs string, rawTarget string) (SymlinkMapping, error) {
	if !filepath.IsAbs(mapper.sourceAbs) || !filepath.IsAbs(mapper.destAbs) ||
		!filepath.IsAbs(sourceLinkAbs) || !filepath.IsAbs(destLinkAbs) || rawTarget == "" {
		return SymlinkMapping{}, fmt.Errorf("%w: invalid symlink mapping path", ErrInvalidRequest)
	}

	lexicalTarget := rawTarget
	if !filepath.IsAbs(lexicalTarget) {
		lexicalTarget = filepath.Join(filepath.Dir(sourceLinkAbs), lexicalTarget)
	}
	lexicalTarget = filepath.Clean(lexicalTarget)

	mapping := SymlinkMapping{
		Kind:           MappingExternal,
		OriginalTarget: rawTarget,
		LexicalTarget:  lexicalTarget,
		FinalTarget:    lexicalTarget,
	}
	if relative, inside := relativeWithin(mapper.sourceAbs, lexicalTarget); inside {
		mapping.Kind = MappingInternal
		mapping.FinalTarget = filepath.Join(mapper.destAbs, relative)
	} else if filepath.IsAbs(rawTarget) && mapper.sourceAliasAbs != "" {
		if relative, inside := relativeWithin(mapper.sourceAliasAbs, lexicalTarget); inside {
			mapping.Kind = MappingInternal
			mapping.FinalTarget = filepath.Join(mapper.destAbs, relative)
		}
	}
	mapping.TargetText = RelativeLinkTarget(filepath.Dir(destLinkAbs), mapping.FinalTarget)
	return mapping, nil
}

func RelativeLinkTarget(finalParent string, target string) string {
	finalParent = filepath.Clean(finalParent)
	target = filepath.Clean(target)
	relative, err := filepath.Rel(finalParent, target)
	if err != nil || filepath.IsAbs(relative) || hasDifferentVolume(finalParent, target) {
		return target
	}
	return relative
}

func relativeWithin(parent string, candidate string) (string, bool) {
	parent = filepath.Clean(parent)
	candidate = filepath.Clean(candidate)
	relative, err := filepath.Rel(parent, candidate)
	if err != nil || filepath.IsAbs(relative) || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", false
	}
	return relative, true
}

func hasDifferentVolume(first string, second string) bool {
	firstVolume := filepath.VolumeName(first)
	secondVolume := filepath.VolumeName(second)
	return firstVolume != "" && secondVolume != "" && !strings.EqualFold(firstVolume, secondVolume)
}
