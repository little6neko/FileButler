package ops

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"syscall"

	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/links"
)

type durableCopyKey struct{}

func sameRevision(a, b os.FileInfo) bool {
	return os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime() == b.ModTime()
}

func snapshotTree(path string) (map[string]os.FileInfo, error) {
	result := make(map[string]os.FileInfo)
	err := filepath.WalkDir(path, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.IsDir() && !info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 {
			return fmt.Errorf("不支持移动特殊文件：%s", path)
		}
		result[path] = info
		return nil
	})
	return result, err
}

func movePath(ctx context.Context, src, dest string, rename func(string, string) error) error {
	if rename == nil {
		rename = links.RenameNoReplace
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := rename(src, dest); err == nil {
		return nil
	} else if !errors.Is(err, syscall.EXDEV) {
		return err
	}
	before, err := snapshotTree(src)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(filepath.Dir(dest), ".filebutler-move-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	payload := filepath.Join(stage, "payload")
	if err := copyPath(context.WithValue(ctx, durableCopyKey{}, true), src, payload); err != nil {
		return err
	}
	after, err := snapshotTree(src)
	if err != nil {
		return err
	}
	if len(before) != len(after) {
		return fmt.Errorf("复制期间源目录发生变化，未删除源文件")
	}
	for path, info := range before {
		if current := after[path]; current == nil || !sameRevision(info, current) {
			return fmt.Errorf("复制期间源文件发生变化，未删除源文件：%s", path)
		}
	}
	if err := jobs.Report(ctx, jobs.TransferProgress{Phase: "waiting", File: filepath.Base(src), Cancelable: true}); err != nil {
		return err
	}
	if err := links.RenameNoReplace(payload, dest); err != nil {
		return err
	}
	// Remove only the copied entries, never recursively remove a changed tree.
	paths := make([]string, 0, len(before))
	for path := range before {
		paths = append(paths, path)
	}
	sort.Slice(paths, func(i, j int) bool { return len(paths[i]) > len(paths[j]) })
	for _, path := range paths {
		if err := jobs.Report(ctx, jobs.TransferProgress{Phase: "delete-source", File: filepath.Base(path), Cancelable: true}); err != nil {
			return err
		}
		info, err := os.Lstat(path)
		old := before[path]
		if err != nil || !os.SameFile(old, info) || old.Mode() != info.Mode() || (!old.IsDir() && !sameRevision(old, info)) {
			return fmt.Errorf("复制成功，源文件发生变化或无法访问，未完整删除：%s", path)
		}
		// A changed ancestor must not redirect a deletion into another directory.
		for parent := filepath.Dir(path); parent != filepath.Dir(src); parent = filepath.Dir(parent) {
			current, err := os.Lstat(parent)
			if err != nil || before[parent] == nil || !os.SameFile(before[parent], current) {
				return fmt.Errorf("复制成功，源目录发生变化，未完整删除")
			}
		}
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("复制成功，源文件删除失败：%w", err)
		}
	}
	return nil
}
