package superrename

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/little6neko/filebutler/internal/natsort"
	"github.com/little6neko/filebutler/internal/roots"
)

var (
	ErrNotDirectory      = errors.New("superrename_not_directory")
	ErrReservedDirectory = errors.New("superrename_reserved_directory")
)

const (
	videoDirectoryName = "视频"
	recoveryPrefix     = ".filebutler-superrename-"
)

type Scanner struct {
	Resolver roots.Resolver
	Now      func() time.Time
}

func (s Scanner) Scan(ctx context.Context, rootID string, directoryPath string) (Inventory, error) {
	if err := ctx.Err(); err != nil {
		return Inventory{}, err
	}
	resolved, err := s.resolveDirectory(rootID, directoryPath)
	if err != nil {
		return Inventory{}, err
	}

	entries, err := os.ReadDir(resolved.CanonicalAbs)
	if err != nil {
		return Inventory{}, err
	}
	groups := make([]InventoryGroup, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return Inventory{}, err
		}
		if strings.HasPrefix(entry.Name(), recoveryPrefix) {
			continue
		}
		groupAbs := filepath.Join(resolved.CanonicalAbs, entry.Name())
		groupInfo, err := os.Lstat(groupAbs)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return Inventory{}, err
		}
		if groupInfo.Mode()&os.ModeSymlink != 0 || !groupInfo.IsDir() {
			continue
		}
		groupPath := joinRelative(filepath.ToSlash(resolved.Rel), entry.Name())
		group, err := s.scanGroup(ctx, groupAbs, groupPath, entry.Name())
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return Inventory{}, err
		}
		groups = append(groups, group)
	}
	sort.SliceStable(groups, func(i, j int) bool {
		return natsort.Less(groups[i].Name, groups[j].Name)
	})

	return Inventory{
		RootID:          rootID,
		DirectoryPath:   filepath.ToSlash(resolved.Rel),
		GeneratedAtUnix: s.generatedAtUnix(),
		Groups:          groups,
	}, nil
}

func (s Scanner) ScanGroup(
	ctx context.Context,
	rootID string,
	directoryPath string,
	groupPath string,
) (InventoryGroup, error) {
	if err := ctx.Err(); err != nil {
		return InventoryGroup{}, err
	}
	scope, err := s.resolveDirectory(rootID, directoryPath)
	if err != nil {
		return InventoryGroup{}, err
	}
	return s.scanResolvedGroup(ctx, rootID, scope, groupPath)
}

func (s Scanner) ScanSelection(
	ctx context.Context,
	rootID string,
	directoryPath string,
	selectedPaths []string,
) (Inventory, error) {
	if err := ctx.Err(); err != nil {
		return Inventory{}, err
	}
	scope, err := s.resolveDirectory(rootID, directoryPath)
	if err != nil {
		return Inventory{}, err
	}
	groupPaths := make(map[string]struct{}, len(selectedPaths))
	for _, selectedPath := range selectedPaths {
		normalized, err := normalizeStrictRelativePath(selectedPath)
		if err != nil {
			return Inventory{}, err
		}
		groupPaths[path.Dir(normalized)] = struct{}{}
	}
	orderedPaths := make([]string, 0, len(groupPaths))
	for groupPath := range groupPaths {
		orderedPaths = append(orderedPaths, groupPath)
	}
	sort.SliceStable(orderedPaths, func(i, j int) bool {
		return natsort.Less(orderedPaths[i], orderedPaths[j])
	})
	groups := make([]InventoryGroup, 0, len(orderedPaths))
	for _, groupPath := range orderedPaths {
		group, err := s.scanResolvedGroup(ctx, rootID, scope, groupPath)
		if err != nil {
			return Inventory{}, err
		}
		groups = append(groups, group)
	}
	return Inventory{
		RootID:          rootID,
		DirectoryPath:   filepath.ToSlash(scope.Rel),
		GeneratedAtUnix: s.generatedAtUnix(),
		Groups:          groups,
	}, nil
}

func (s Scanner) resolveDirectory(rootID string, directoryPath string) (roots.ResolvedPath, error) {
	resolved, err := s.Resolver.ResolveForWrite(rootID, directoryPath)
	if err != nil {
		return roots.ResolvedPath{}, err
	}
	if resolved.Rel != "." {
		requestedInfo, err := os.Lstat(resolved.Abs)
		if err != nil {
			return roots.ResolvedPath{}, err
		}
		if requestedInfo.Mode()&os.ModeSymlink != 0 {
			return roots.ResolvedPath{}, ErrNotDirectory
		}
	}
	info, err := os.Stat(resolved.CanonicalAbs)
	if err != nil {
		return roots.ResolvedPath{}, err
	}
	if !info.IsDir() {
		return roots.ResolvedPath{}, ErrNotDirectory
	}
	return resolved, nil
}

func (s Scanner) scanResolvedGroup(
	ctx context.Context,
	rootID string,
	scope roots.ResolvedPath,
	groupPath string,
) (InventoryGroup, error) {
	normalizedGroupPath, err := normalizeStrictRelativePath(groupPath)
	if err != nil {
		return InventoryGroup{}, err
	}
	scopePath := filepath.ToSlash(scope.Rel)
	segments, err := strictDescendantSegments(scopePath, normalizedGroupPath)
	if err != nil {
		return InventoryGroup{}, err
	}
	currentAbs := scope.CanonicalAbs
	for index, segment := range segments {
		if strings.HasPrefix(segment, recoveryPrefix) || (index > 0 && segment == videoDirectoryName) {
			return InventoryGroup{}, fmt.Errorf("%w: %s", ErrReservedDirectory, normalizedGroupPath)
		}
		currentAbs = filepath.Join(currentAbs, filepath.FromSlash(segment))
		info, err := os.Lstat(currentAbs)
		if err != nil {
			return InventoryGroup{}, err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return InventoryGroup{}, ErrNotDirectory
		}
	}
	resolvedGroup, err := s.Resolver.ResolveForWrite(rootID, normalizedGroupPath)
	if err != nil {
		return InventoryGroup{}, err
	}
	if filepath.Clean(resolvedGroup.CanonicalAbs) != filepath.Clean(currentAbs) {
		return InventoryGroup{}, ErrNotDirectory
	}
	return s.scanGroup(ctx, currentAbs, normalizedGroupPath, path.Base(normalizedGroupPath))
}

func normalizeStrictRelativePath(value string) (string, error) {
	if value == "" {
		return "", roots.ErrInvalidPath
	}
	normalized := strings.ReplaceAll(value, "\\", "/")
	if strings.HasPrefix(normalized, "/") || isWindowsAbsolutePath(normalized) {
		return "", roots.ErrInvalidPath
	}
	segments := strings.Split(normalized, "/")
	for _, segment := range segments {
		if segment == "" || segment == "." || segment == ".." {
			return "", roots.ErrInvalidPath
		}
	}
	return strings.Join(segments, "/"), nil
}

func strictDescendantSegments(scopePath string, groupPath string) ([]string, error) {
	if scopePath == "." {
		return strings.Split(groupPath, "/"), nil
	}
	if groupPath == scopePath {
		return nil, roots.ErrInvalidPath
	}
	prefix := scopePath + "/"
	if !strings.HasPrefix(groupPath, prefix) {
		return nil, roots.ErrOutsideRoot
	}
	return strings.Split(strings.TrimPrefix(groupPath, prefix), "/"), nil
}

func isWindowsAbsolutePath(value string) bool {
	return len(value) >= 3 && ((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) && value[1] == ':' && value[2] == '/'
}

func (s Scanner) generatedAtUnix() int64 {
	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	return now.UTC().Unix()
}

func (s Scanner) scanGroup(ctx context.Context, groupAbs string, groupPath string, groupName string) (InventoryGroup, error) {
	entries, err := os.ReadDir(groupAbs)
	if err != nil {
		return InventoryGroup{}, err
	}
	group := InventoryGroup{
		Path:             groupPath,
		Name:             groupName,
		Images:           []Candidate{},
		Videos:           []Candidate{},
		Unmatched:        []Unmatched{},
		ChildDirectories: []DirectoryRef{},
		VideoDirectory: VideoDirectory{
			Status:        VideoDirectoryMissing,
			Path:          joinRelative(groupPath, videoDirectoryName),
			OccupiedPaths: []string{},
		},
		DirectOccupiedPaths: []string{},
		RecoveryResidues:    []string{},
	}

	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return InventoryGroup{}, err
		}
		name := entry.Name()
		entryAbs := filepath.Join(groupAbs, name)
		entryPath := joinRelative(groupPath, name)
		info, err := os.Lstat(entryAbs)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return InventoryGroup{}, err
		}
		group.DirectOccupiedPaths = append(group.DirectOccupiedPaths, entryPath)
		if strings.HasPrefix(name, recoveryPrefix) {
			group.RecoveryResidues = append(group.RecoveryResidues, entryPath)
		}

		kind := entryKind(info)
		if name == videoDirectoryName {
			switch {
			case kind == EntryKindDirectory:
				group.VideoDirectory.Status = VideoDirectoryPresent
				occupied, err := readOccupiedPaths(ctx, entryAbs, entryPath)
				if os.IsNotExist(err) {
					group.VideoDirectory.Status = VideoDirectoryMissing
					continue
				}
				if err != nil {
					return InventoryGroup{}, err
				}
				group.VideoDirectory.OccupiedPaths = occupied
			case kind == EntryKindSymlink:
				group.VideoDirectory.Status = VideoDirectoryBlockingEntry
				group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: UnmatchedSymlink})
			default:
				group.VideoDirectory.Status = VideoDirectoryBlockingEntry
				group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: unmatchedReason(kind)})
			}
			continue
		}

		switch kind {
		case EntryKindFile:
			mediaKind, extension, matched := ClassifyMedia(name)
			if !matched {
				group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: UnmatchedUnsupportedExtension})
				continue
			}
			candidate := Candidate{SourcePath: entryPath, Name: name, Extension: extension, MediaKind: mediaKind}
			if mediaKind == MediaKindImage {
				group.Images = append(group.Images, candidate)
			} else {
				group.Videos = append(group.Videos, candidate)
			}
		case EntryKindDirectory:
			if strings.HasPrefix(name, recoveryPrefix) {
				group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: UnmatchedNestedDirectory})
			} else {
				group.ChildDirectories = append(group.ChildDirectories, DirectoryRef{Path: entryPath, Name: name})
			}
		case EntryKindSymlink:
			group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: UnmatchedSymlink})
		default:
			group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: UnmatchedSpecial})
		}
	}

	sortCandidates(group.Images)
	sortCandidates(group.Videos)
	sort.SliceStable(group.Unmatched, func(i, j int) bool {
		return natsort.Less(group.Unmatched[i].Name, group.Unmatched[j].Name)
	})
	sort.SliceStable(group.ChildDirectories, func(i, j int) bool {
		return natsort.Less(group.ChildDirectories[i].Name, group.ChildDirectories[j].Name)
	})
	sortPathsByBase(group.DirectOccupiedPaths)
	sortPathsByBase(group.RecoveryResidues)
	return group, nil
}

func readOccupiedPaths(ctx context.Context, directoryAbs string, directoryPath string) ([]string, error) {
	entries, err := os.ReadDir(directoryAbs)
	if err != nil {
		return nil, err
	}
	paths := make([]string, 0, len(entries))
	for _, entry := range entries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		entryAbs := filepath.Join(directoryAbs, entry.Name())
		if _, err := os.Lstat(entryAbs); os.IsNotExist(err) {
			continue
		} else if err != nil {
			return nil, err
		}
		paths = append(paths, joinRelative(directoryPath, entry.Name()))
	}
	sortPathsByBase(paths)
	return paths, nil
}

func entryKind(info os.FileInfo) EntryKind {
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		return EntryKindSymlink
	case info.IsDir():
		return EntryKindDirectory
	case info.Mode().IsRegular():
		return EntryKindFile
	default:
		return EntryKindOther
	}
}

func unmatchedReason(kind EntryKind) UnmatchedReason {
	switch kind {
	case EntryKindFile:
		return UnmatchedUnsupportedExtension
	case EntryKindDirectory:
		return UnmatchedNestedDirectory
	case EntryKindSymlink:
		return UnmatchedSymlink
	default:
		return UnmatchedSpecial
	}
}

func sortCandidates(candidates []Candidate) {
	sort.SliceStable(candidates, func(i, j int) bool {
		return natsort.Less(candidates[i].Name, candidates[j].Name)
	})
}

func sortPathsByBase(paths []string) {
	sort.SliceStable(paths, func(i, j int) bool {
		left := path.Base(paths[i])
		right := path.Base(paths[j])
		if left == right {
			return paths[i] < paths[j]
		}
		return natsort.Less(left, right)
	})
}
