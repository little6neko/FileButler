package browser

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"

	"github.com/little6neko/filebutler/internal/natsort"
	"github.com/little6neko/filebutler/internal/roots"
)

var ErrNotDirectory = errors.New("not_directory")

type Entry struct {
	Name              string             `json:"name"`
	RelativePath      string             `json:"relativePath"`
	Type              string             `json:"type"`
	Size              int64              `json:"size"`
	Mode              string             `json:"mode"`
	ModifiedUnix      int64              `json:"modifiedUnix"`
	IsSymlink         bool               `json:"isSymlink"`
	SymlinkTarget     string             `json:"symlinkTarget,omitempty"`
	SymlinkResolution *SymlinkResolution `json:"symlinkResolution,omitempty"`
}

type SymlinkState string

const (
	SymlinkMapped   SymlinkState = "mapped"
	SymlinkUnmapped SymlinkState = "unmapped"
	SymlinkBroken   SymlinkState = "broken"
)

type SymlinkResolution struct {
	State        SymlinkState `json:"state"`
	TargetKind   string       `json:"targetKind,omitempty"`
	TargetRootID string       `json:"targetRootId,omitempty"`
	TargetPath   string       `json:"targetPath,omitempty"`
}

type Service struct {
	Resolver   roots.Resolver
	Maintainer DirectoryMaintainer
}

type DirectoryMaintainer interface {
	Maintain(context.Context, string) (map[string]struct{}, error)
}

func (s Service) List(ctx context.Context, rootID string, rel string) ([]Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolved, err := s.Resolver.ResolveFollow(rootID, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(resolved.Actual.Abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, ErrNotDirectory
	}
	var hidden map[string]struct{}
	if s.Maintainer != nil {
		hidden, err = s.Maintainer.Maintain(ctx, resolved.Actual.Abs)
		if err != nil {
			return nil, err
		}
	}
	dirEntries, err := os.ReadDir(resolved.Actual.Abs)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, hide := hidden[dirEntry.Name()]; hide {
			continue
		}
		info, err := dirEntry.Info()
		if err != nil {
			return nil, err
		}
		name := dirEntry.Name()
		childRel := name
		if resolved.Requested.Rel != "." {
			childRel = filepath.ToSlash(filepath.Join(resolved.Requested.Rel, name))
		}
		entry := Entry{
			Name:         name,
			RelativePath: childRel,
			Type:         entryType(info),
			Size:         info.Size(),
			Mode:         info.Mode().String(),
			ModifiedUnix: info.ModTime().Unix(),
			IsSymlink:    info.Mode()&os.ModeSymlink != 0,
		}
		if entry.IsSymlink {
			target, err := os.Readlink(filepath.Join(resolved.Actual.Abs, name))
			if err != nil {
				return nil, err
			}
			entry.Type = "symlink"
			entry.SymlinkTarget = target
			resolution := s.resolveSymlink(rootID, childRel)
			entry.SymlinkResolution = &resolution
		}
		out = append(out, entry)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return natsort.Less(out[i].Name, out[j].Name)
	})
	return out, nil
}

func (s Service) resolveSymlink(rootID string, rel string) SymlinkResolution {
	resolved, err := s.Resolver.ResolveFollow(rootID, rel)
	if errors.Is(err, roots.ErrOutsideRoot) {
		return SymlinkResolution{State: SymlinkUnmapped}
	}
	if err != nil {
		return SymlinkResolution{State: SymlinkBroken}
	}
	info, err := os.Lstat(resolved.Actual.Abs)
	if err != nil {
		return SymlinkResolution{State: SymlinkBroken}
	}
	return SymlinkResolution{
		State:        SymlinkMapped,
		TargetKind:   entryType(info),
		TargetRootID: resolved.Actual.Root.ID,
		TargetPath:   filepath.ToSlash(resolved.Actual.Rel),
	}
}

func entryType(info os.FileInfo) string {
	if info.IsDir() {
		return "directory"
	}
	if info.Mode().IsRegular() {
		return "file"
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "symlink"
	}
	return "other"
}
