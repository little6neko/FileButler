package ops

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/little6neko/filebutler/internal/jobs"
	"github.com/little6neko/filebutler/internal/roots"
	"github.com/little6neko/filebutler/internal/storage"
)

type Executor struct {
	Resolver roots.Resolver
	Cache    *storage.Store
}

func (e Executor) Execute(ctx context.Context, item PlanItem) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	switch item.Operation {
	case OpMove:
		if filepath.Clean(item.SourcePath) == "." || item.SourcePath == "" {
			return fmt.Errorf("不能移动根目录")
		}
		src, err := resolveOperationSource(e.Resolver, item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		dest, err := e.Resolver.ResolveCreate(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		e.Cache.InvalidateLocal(src.Actual.Root.ID, src.Actual.Root.Path, src.Actual.Rel)
		defer e.Cache.InvalidateLocal(src.Actual.Root.ID, src.Actual.Root.Path, src.Actual.Rel)
		defer e.Cache.InvalidateLocal(dest.Actual.Root.ID, dest.Actual.Root.Path, dest.Actual.Rel)
		return movePath(ctx, src.Actual.Abs, dest.Actual.Abs, nil)
	case OpCopy:
		src, err := resolveOperationSource(e.Resolver, item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		dest, err := e.Resolver.ResolveCreate(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		defer e.Cache.InvalidateLocal(dest.Actual.Root.ID, dest.Actual.Root.Path, dest.Actual.Rel)
		return copyPath(ctx, src.Actual.Abs, dest.Actual.Abs)
	case OpDelete:
		src, err := resolveOperationSource(e.Resolver, item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		e.Cache.InvalidateLocal(src.Actual.Root.ID, src.Actual.Root.Path, src.Actual.Rel)
		defer e.Cache.InvalidateLocal(src.Actual.Root.ID, src.Actual.Root.Path, src.Actual.Rel)
		return os.RemoveAll(src.Actual.Abs)
	case OpMkdir:
		dest, err := e.Resolver.ResolveCreate(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		return os.Mkdir(dest.Actual.Abs, 0o755)
	default:
		return os.ErrInvalid
	}
}

func copyPath(ctx context.Context, src, dest string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	info, err := os.Lstat(src)
	if err != nil {
		return err
	}
	if info.IsDir() {
		if err := os.MkdirAll(dest, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(src)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyPath(ctx, filepath.Join(src, entry.Name()), filepath.Join(dest, entry.Name())); err != nil {
				return err
			}
		}
		return nil
	}
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(src)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return err
		}
		return os.Symlink(target, dest)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("不支持复制特殊文件：%s", src)
	}
	return copyFileContext(ctx, src, dest, info.Mode().Perm())
}

func copyFile(src, dest string, mode os.FileMode) error {
	return copyFileContext(context.Background(), src, dest, mode)
}

func copyFileContext(ctx context.Context, src, dest string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	progress := jobs.TransferProgress{Phase: "copy", File: filepath.Base(src), BytesTotal: info.Size(), Cancelable: true}
	if err := jobs.Report(ctx, progress); err != nil {
		return err
	}
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		_ = out.Close()
		if !completed {
			_ = os.Remove(dest)
		}
	}()
	buffer := make([]byte, 256*1024)
	for {
		n, readErr := in.Read(buffer)
		if n > 0 {
			written, err := out.Write(buffer[:n])
			if err != nil {
				return err
			}
			if written != n {
				return io.ErrShortWrite
			}
			progress.BytesDone += int64(n)
			if err := jobs.Report(ctx, progress); err != nil {
				return err
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	current, err := in.Stat()
	if err != nil {
		return err
	}
	if progress.BytesDone != info.Size() || !sameRevision(info, current) {
		return fmt.Errorf("复制期间源文件发生变化：%s", src)
	}
	if durable, _ := ctx.Value(durableCopyKey{}).(bool); durable {
		if err := out.Sync(); err != nil {
			return err
		}
	}
	if err := out.Close(); err != nil {
		return err
	}
	completed = true
	return nil
}
