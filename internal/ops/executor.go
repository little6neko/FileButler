package ops

import (
	"context"
	"io"
	"os"
	"path/filepath"

	"github.com/little6neko/filebutler/internal/roots"
)

type Executor struct {
	Resolver roots.Resolver
}

func (e Executor) Execute(ctx context.Context, item PlanItem) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	switch item.Operation {
	case OpMove:
		src, err := e.Resolver.ResolveForWrite(item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		dest, err := e.Resolver.ResolveForWrite(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dest.Abs), 0o755); err != nil {
			return err
		}
		return os.Rename(src.Abs, dest.Abs)
	case OpCopy:
		src, err := e.Resolver.ResolveForWrite(item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		dest, err := e.Resolver.ResolveForWrite(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		return copyPath(ctx, src.Abs, dest.Abs)
	case OpSymlink:
		src, err := e.Resolver.ResolveForWrite(item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		dest, err := e.Resolver.ResolveForWrite(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dest.Abs), 0o755); err != nil {
			return err
		}
		return os.Symlink(src.Abs, dest.Abs)
	case OpHardlink:
		src, err := e.Resolver.ResolveForWrite(item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		dest, err := e.Resolver.ResolveForWrite(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(dest.Abs), 0o755); err != nil {
			return err
		}
		return os.Link(src.Abs, dest.Abs)
	case OpDelete:
		src, err := e.Resolver.ResolveForWrite(item.SourceRoot, item.SourcePath)
		if err != nil {
			return err
		}
		return os.RemoveAll(src.Abs)
	case OpMkdir:
		dest, err := e.Resolver.ResolveForWrite(item.DestRoot, item.DestPath)
		if err != nil {
			return err
		}
		return os.Mkdir(dest.Abs, 0o755)
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
	return copyFile(src, dest, info.Mode().Perm())
}

func copyFile(src, dest string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}
