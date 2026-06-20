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
	Name          string `json:"name"`
	RelativePath  string `json:"relativePath"`
	Type          string `json:"type"`
	Size          int64  `json:"size"`
	Mode          string `json:"mode"`
	ModifiedUnix  int64  `json:"modifiedUnix"`
	IsSymlink     bool   `json:"isSymlink"`
	SymlinkTarget string `json:"symlinkTarget,omitempty"`
}

type Service struct {
	Resolver roots.Resolver
}

func (s Service) List(ctx context.Context, rootID string, rel string) ([]Entry, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resolved, err := s.Resolver.Resolve(rootID, rel)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(resolved.Abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, ErrNotDirectory
	}
	dirEntries, err := os.ReadDir(resolved.Abs)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(dirEntries))
	for _, dirEntry := range dirEntries {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		info, err := dirEntry.Info()
		if err != nil {
			return nil, err
		}
		name := dirEntry.Name()
		childRel := name
		if resolved.Rel != "." {
			childRel = filepath.ToSlash(filepath.Join(resolved.Rel, name))
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
			target, err := os.Readlink(filepath.Join(resolved.Abs, name))
			if err != nil {
				return nil, err
			}
			entry.Type = "symlink"
			entry.SymlinkTarget = target
		}
		out = append(out, entry)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return natsort.Less(out[i].Name, out[j].Name)
	})
	return out, nil
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
