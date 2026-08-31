package links

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/little6neko/filebutler/internal/roots"
)

type identityReaderFunc func(string, bool) (FileIdentity, error)

type Planner struct {
	Resolver roots.Resolver
	identity identityReaderFunc
	lstat    func(string) (os.FileInfo, error)
	readlink func(string) (string, error)
}

type normalizedSource struct {
	path         string
	requestedAbs string
}

type normalizedRequest struct {
	request             Request
	sources             []normalizedSource
	destination         roots.MappedPath
	destinationIdentity FileIdentity
}

type planningConflict struct {
	code ErrorCode
	text string
}

func (planner Planner) Plan(ctx context.Context, request Request) (Plan, error) {
	if err := ctx.Err(); err != nil {
		return Plan{}, err
	}
	normalized, err := planner.normalizeRequest(request)
	if err != nil {
		return Plan{}, err
	}
	preview := Preview{
		Type:       normalized.request.Type,
		SourceRoot: normalized.request.SourceRoot,
		DestRoot:   normalized.request.DestRoot,
		DestPath:   normalized.request.DestPath,
		Items:      make([]PreviewItem, 0, len(normalized.sources)),
	}
	groups := make([]PlanGroup, 0, len(normalized.sources))
	for _, source := range normalized.sources {
		if err := ctx.Err(); err != nil {
			return Plan{}, err
		}
		group, item, err := planner.planSource(ctx, normalized, source)
		if err != nil {
			return Plan{}, err
		}
		if item.Conflict {
			preview.HasConflict = true
		}
		preview.ProgressTotal += item.Counts.Total()
		preview.Items = append(preview.Items, item)
		groups = append(groups, group)
	}
	revision, err := computeRevision(preview, groups)
	if err != nil {
		return Plan{}, err
	}
	preview.PreviewRevision = revision
	for index := range groups {
		groups[index].PreviewRevision = revision
	}
	return Plan{Preview: preview, Groups: groups}, nil
}

func (planner Planner) normalizeRequest(request Request) (normalizedRequest, error) {
	if request.Type != LinkHardlink && request.Type != LinkSymlink {
		return normalizedRequest{}, fmt.Errorf("%w: unsupported link type", ErrInvalidRequest)
	}
	if len(request.Sources) == 0 {
		return normalizedRequest{}, fmt.Errorf("%w: sources are required", ErrInvalidRequest)
	}
	if _, err := planner.Resolver.Resolve(request.SourceRoot, "."); err != nil {
		return normalizedRequest{}, err
	}

	destPath := request.DestPath
	if destPath == "" {
		destPath = "."
	}
	destination, err := planner.Resolver.ResolveFollow(request.DestRoot, destPath)
	if err != nil {
		return normalizedRequest{}, err
	}
	destinationInfo, err := planner.lstatReader()(destination.Actual.Abs)
	if err != nil {
		return normalizedRequest{}, err
	}
	if !destinationInfo.IsDir() {
		return normalizedRequest{}, ErrNotDirectory
	}
	destinationIdentity, err := planner.identityReader()(destination.Actual.Abs, false)
	if err != nil {
		return normalizedRequest{}, err
	}

	seen := make(map[string]struct{}, len(request.Sources))
	sources := make([]normalizedSource, 0, len(request.Sources))
	parent := ""
	for _, sourcePath := range request.Sources {
		if sourcePath == "" {
			return normalizedRequest{}, fmt.Errorf("%w: source path is empty", ErrInvalidRequest)
		}
		resolved, err := planner.Resolver.Resolve(request.SourceRoot, sourcePath)
		if err != nil {
			return normalizedRequest{}, err
		}
		normalizedPath := filepath.ToSlash(resolved.Rel)
		if normalizedPath == "." {
			return normalizedRequest{}, fmt.Errorf("%w: a mapped root cannot be a source", ErrInvalidRequest)
		}
		if _, duplicate := seen[normalizedPath]; duplicate {
			return normalizedRequest{}, fmt.Errorf("%w: duplicate source", ErrInvalidRequest)
		}
		seen[normalizedPath] = struct{}{}
		currentParent := path.Dir(normalizedPath)
		if len(sources) == 0 {
			parent = currentParent
		} else if currentParent != parent {
			return normalizedRequest{}, fmt.Errorf("%w: sources must share a parent", ErrInvalidRequest)
		}
		sources = append(sources, normalizedSource{path: normalizedPath, requestedAbs: resolved.Abs})
	}

	request.Sources = make([]string, len(sources))
	for index := range sources {
		request.Sources[index] = sources[index].path
	}
	request.DestPath = filepath.ToSlash(destination.Requested.Rel)
	return normalizedRequest{
		request:             request,
		sources:             sources,
		destination:         destination,
		destinationIdentity: destinationIdentity,
	}, nil
}

func (planner Planner) planSource(
	ctx context.Context,
	normalized normalizedRequest,
	source normalizedSource,
) (PlanGroup, PreviewItem, error) {
	destName := path.Base(source.path)
	destPath := joinRelative(normalized.request.DestPath, destName)
	destAbs := filepath.Join(normalized.destination.Actual.Abs, filepath.FromSlash(destName))
	if _, err := planner.Resolver.MapPath(destAbs); err != nil {
		return PlanGroup{}, PreviewItem{}, err
	}
	group := PlanGroup{
		Type:                normalized.request.Type,
		SourceRoot:          normalized.request.SourceRoot,
		SourcePath:          source.path,
		SourceRequestedAbs:  source.requestedAbs,
		DestRoot:            normalized.request.DestRoot,
		DestPath:            destPath,
		DestName:            destName,
		DestParentAbs:       normalized.destination.Actual.Abs,
		DestAbs:             destAbs,
		DestinationIdentity: normalized.destinationIdentity,
		Steps:               []PlanStep{},
	}
	item := PreviewItem{
		SourcePath: source.path,
		DestPath:   destPath,
		SourceKind: SourceOther,
	}

	targetConflict, err := planner.inspectTarget(&group)
	if err != nil {
		return PlanGroup{}, PreviewItem{}, err
	}

	resolved, err := planner.Resolver.ResolveEntry(normalized.request.SourceRoot, source.path)
	if err != nil {
		conflict := conflictForSourceError(err)
		setConflict(&group, &item, conflict.code, conflict.text)
		applyDeferredConflict(&group, &item, targetConflict)
		return group, item, nil
	}
	group.SourceAbs = resolved.Actual.Abs
	info, err := planner.lstatReader()(resolved.Actual.Abs)
	if err != nil {
		conflict := conflictForSourceError(err)
		setConflict(&group, &item, conflict.code, conflict.text)
		applyDeferredConflict(&group, &item, targetConflict)
		return group, item, nil
	}
	group.SourceKind = sourceKind(info)
	item.SourceKind = group.SourceKind
	identity, err := planner.identityReader()(resolved.Actual.Abs, false)
	if err != nil {
		setConflict(&group, &item, ErrorOperationFailed, "could not identify the source")
		applyDeferredConflict(&group, &item, targetConflict)
		return group, item, nil
	}
	group.SourceIdentity = identity

	switch normalized.request.Type {
	case LinkHardlink:
		if err := planner.planHardlink(ctx, &group, &item, info); err != nil {
			return PlanGroup{}, PreviewItem{}, err
		}
	case LinkSymlink:
		planner.planSymlink(&group, &item, info)
	}
	applyDeferredConflict(&group, &item, targetConflict)
	item.Counts = countSteps(group.Steps)
	return group, item, nil
}

func (planner Planner) planHardlink(ctx context.Context, group *PlanGroup, item *PreviewItem, info os.FileInfo) error {
	switch {
	case info.Mode().IsRegular():
		if !group.SourceIdentity.SameFilesystem(group.DestinationIdentity) {
			setConflict(group, item, ErrorCrossFilesystem, "source and destination are on different filesystems")
		}
		group.Steps = append(group.Steps, PlanStep{
			Action: ActionHardlink, RelativePath: ".", SourceIdentity: group.SourceIdentity,
		})
	case info.IsDir():
		if _, inside := relativeWithin(group.SourceAbs, group.DestAbs); inside {
			setConflict(group, item, ErrorDestinationInsideSource, "destination cannot be inside the source directory")
		}
		steps, conflict, err := planner.scanDirectory(ctx, *group)
		if err != nil {
			if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
				return err
			}
			setConflict(group, item, ErrorOperationFailed, "could not scan the source directory")
			return nil
		}
		group.Steps = steps
		if conflict != nil {
			setConflict(group, item, conflict.code, conflict.text)
		}
	case info.Mode()&os.ModeSymlink != 0:
		setConflict(group, item, ErrorUnsupportedSource, "top-level symbolic links are not supported")
	default:
		setConflict(group, item, ErrorUnsupportedSource, "source type is not supported")
	}
	return nil
}

func (planner Planner) planSymlink(group *PlanGroup, item *PreviewItem, info os.FileInfo) {
	if info.Mode()&os.ModeSymlink != 0 || (!info.Mode().IsRegular() && !info.IsDir()) {
		setConflict(group, item, ErrorUnsupportedSource, "source type is not supported")
		return
	}
	group.Steps = append(group.Steps, PlanStep{
		Action:         ActionSymlink,
		RelativePath:   ".",
		SourceIdentity: group.SourceIdentity,
		TargetText:     RelativeLinkTarget(group.DestParentAbs, group.SourceAbs),
		Mapping:        MappingExternal,
	})
}

func (planner Planner) scanDirectory(ctx context.Context, group PlanGroup) ([]PlanStep, *planningConflict, error) {
	steps := make([]PlanStep, 0)
	var firstConflict *planningConflict
	mapper := NewPathMapper(group.SourceAbs, group.SourceRequestedAbs, group.DestAbs)
	err := filepath.WalkDir(group.SourceAbs, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := planner.lstatReader()(currentPath)
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(group.SourceAbs, currentPath)
		if err != nil {
			return err
		}
		relative = filepath.ToSlash(relative)
		identity, err := planner.identityReader()(currentPath, false)
		if err != nil {
			return err
		}
		switch {
		case info.IsDir():
			steps = append(steps, PlanStep{
				Action: ActionDirectory, RelativePath: relative, SourceIdentity: identity,
				Mode: info.Mode().Perm(), ModifiedUnixNano: info.ModTime().UnixNano(),
			})
		case info.Mode().IsRegular():
			steps = append(steps, PlanStep{
				Action: ActionHardlink, RelativePath: relative, SourceIdentity: identity,
			})
			if !identity.SameFilesystem(group.DestinationIdentity) && firstConflict == nil {
				firstConflict = &planningConflict{
					code: ErrorCrossFilesystem,
					text: "a source file is on a different filesystem from the destination",
				}
			}
		case info.Mode()&os.ModeSymlink != 0:
			rawTarget, err := planner.readlinkReader()(currentPath)
			if err != nil {
				return err
			}
			destLinkAbs := filepath.Join(group.DestAbs, filepath.FromSlash(relative))
			mapping, err := mapper.Map(currentPath, destLinkAbs, rawTarget)
			if err != nil {
				return err
			}
			steps = append(steps, PlanStep{
				Action: ActionSymlink, RelativePath: relative, SourceIdentity: identity,
				OriginalTarget: rawTarget, TargetText: mapping.TargetText, Mapping: mapping.Kind,
			})
		default:
			if firstConflict == nil {
				firstConflict = &planningConflict{code: ErrorSpecialEntry, text: "source directory contains a special entry"}
			}
		}
		return nil
	})
	if err != nil {
		return nil, nil, err
	}
	sort.SliceStable(steps, func(i, j int) bool {
		if steps[i].RelativePath != steps[j].RelativePath {
			return steps[i].RelativePath < steps[j].RelativePath
		}
		return steps[i].Action < steps[j].Action
	})
	return steps, firstConflict, nil
}

func (planner Planner) inspectTarget(group *PlanGroup) (*planningConflict, error) {
	info, err := planner.lstatReader()(group.DestAbs)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return &planningConflict{code: ErrorOperationFailed, text: "could not inspect the destination"}, nil
	}
	group.target.Occupied = true
	group.target.Kind = sourceKind(info)
	identity, identityErr := planner.identityReader()(group.DestAbs, false)
	if identityErr == nil {
		group.target.Identity = identity
	}
	return &planningConflict{code: ErrorTargetExists, text: "destination already exists"}, nil
}

func (planner Planner) identityReader() identityReaderFunc {
	if planner.identity != nil {
		return planner.identity
	}
	return ReadIdentity
}

func (planner Planner) lstatReader() func(string) (os.FileInfo, error) {
	if planner.lstat != nil {
		return planner.lstat
	}
	return os.Lstat
}

func (planner Planner) readlinkReader() func(string) (string, error) {
	if planner.readlink != nil {
		return planner.readlink
	}
	return os.Readlink
}

func conflictForSourceError(err error) planningConflict {
	switch {
	case errors.Is(err, os.ErrNotExist):
		return planningConflict{code: ErrorMissingSource, text: "source does not exist"}
	case errors.Is(err, roots.ErrOutsideRoot):
		return planningConflict{code: ErrorOutsideRoot, text: "source leaves the mapped roots"}
	case errors.Is(err, roots.ErrInvalidPath):
		return planningConflict{code: ErrorInvalidPath, text: "source path is invalid"}
	default:
		return planningConflict{code: ErrorOperationFailed, text: "could not inspect the source"}
	}
}

func setConflict(group *PlanGroup, item *PreviewItem, code ErrorCode, text string) {
	if group.Conflict {
		return
	}
	group.Conflict = true
	group.ErrorCode = code
	item.Conflict = true
	item.ErrorCode = code
	item.ErrorText = text
}

func applyDeferredConflict(group *PlanGroup, item *PreviewItem, conflict *planningConflict) {
	if conflict != nil {
		setConflict(group, item, conflict.code, conflict.text)
	}
}

func countSteps(steps []PlanStep) Counts {
	var counts Counts
	for _, step := range steps {
		switch step.Action {
		case ActionDirectory:
			counts.Directories++
		case ActionHardlink:
			counts.Files++
		case ActionSymlink:
			counts.Symlinks++
		}
	}
	return counts
}

func joinRelative(parent string, name string) string {
	if parent == "" || parent == "." {
		return name
	}
	return strings.TrimSuffix(parent, "/") + "/" + name
}
