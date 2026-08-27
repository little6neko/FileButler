package superrename

import (
	"context"
	"errors"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/little6neko/filebutler/internal/natsort"
	"github.com/little6neko/filebutler/internal/roots"
)

var ErrNotDirectory = errors.New("superrename_not_directory")

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
	resolved, err := s.Resolver.ResolveForWrite(rootID, directoryPath)
	if err != nil {
		return Inventory{}, err
	}
	if resolved.Rel != "." {
		requestedInfo, err := os.Lstat(resolved.Abs)
		if err != nil {
			return Inventory{}, err
		}
		if requestedInfo.Mode()&os.ModeSymlink != 0 {
			return Inventory{}, ErrNotDirectory
		}
	}
	info, err := os.Stat(resolved.CanonicalAbs)
	if err != nil {
		return Inventory{}, err
	}
	if !info.IsDir() {
		return Inventory{}, ErrNotDirectory
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

	now := time.Now()
	if s.Now != nil {
		now = s.Now()
	}
	return Inventory{
		RootID:          rootID,
		DirectoryPath:   filepath.ToSlash(resolved.Rel),
		GeneratedAtUnix: now.UTC().Unix(),
		Groups:          groups,
	}, nil
}

func (s Scanner) scanGroup(ctx context.Context, groupAbs string, groupPath string, groupName string) (InventoryGroup, error) {
	entries, err := os.ReadDir(groupAbs)
	if err != nil {
		return InventoryGroup{}, err
	}
	group := InventoryGroup{
		Path:      groupPath,
		Name:      groupName,
		Images:    []Candidate{},
		Videos:    []Candidate{},
		Unmatched: []Unmatched{},
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
			group.Unmatched = append(group.Unmatched, Unmatched{Path: entryPath, Name: name, Kind: kind, Reason: UnmatchedNestedDirectory})
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
