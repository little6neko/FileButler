package ops

import (
	"context"
	"os"
	"path/filepath"

	"github.com/little6neko/filebutler/internal/roots"
)

type Planner struct {
	Resolver roots.Resolver
}

func (p Planner) Plan(ctx context.Context, req Request) (Plan, error) {
	if err := ctx.Err(); err != nil {
		return Plan{}, err
	}
	var items []PlanItem
	if req.Type == OpMkdir {
		destPath := filepath.ToSlash(filepath.Join(defaultPath(req.DestPath), req.NewName))
		item := PlanItem{Operation: req.Type, DestRoot: req.DestRoot, DestPath: destPath}
		if dest, err := p.Resolver.ResolveForWrite(req.DestRoot, destPath); err != nil {
			item.Conflict = true
			item.ErrorCode = errorCode(err)
			item.ErrorText = err.Error()
		} else if _, err := os.Lstat(dest.Abs); err == nil {
			item.Conflict = true
			item.ErrorCode = "target_exists"
			item.ErrorText = "destination already exists"
		} else if !os.IsNotExist(err) {
			item.Conflict = true
			item.ErrorCode = "operation_failed"
			item.ErrorText = err.Error()
		}
		return finalize([]PlanItem{item}), nil
	}
	for _, src := range req.Sources {
		item := PlanItem{Operation: req.Type, SourceRoot: req.SourceRoot, SourcePath: src}
		source, srcErr := p.Resolver.ResolveForWrite(req.SourceRoot, src)
		if srcErr != nil {
			item.Conflict = true
			item.ErrorCode = errorCode(srcErr)
			item.ErrorText = srcErr.Error()
			items = append(items, item)
			continue
		}
		info, statErr := os.Lstat(source.Abs)
		if statErr != nil {
			item.Conflict = true
			if os.IsNotExist(statErr) {
				item.ErrorCode = "missing_source"
				item.ErrorText = "source does not exist"
			} else {
				item.ErrorCode = "operation_failed"
				item.ErrorText = statErr.Error()
			}
			items = append(items, item)
			continue
		}
		switch req.Type {
		case OpDelete:
		case OpMove, OpCopy, OpSymlink, OpHardlink:
			if req.Type == OpHardlink && info.IsDir() {
				item.Conflict = true
				item.ErrorCode = "hardlink_directory"
				item.ErrorText = "hard links are only supported for files"
				break
			}
			destPath := filepath.ToSlash(filepath.Join(defaultPath(req.DestPath), filepath.Base(src)))
			item.DestRoot = req.DestRoot
			item.DestPath = destPath
			dest, err := p.Resolver.ResolveForWrite(req.DestRoot, destPath)
			if err != nil {
				item.Conflict = true
				item.ErrorCode = errorCode(err)
				item.ErrorText = err.Error()
			} else if _, err := os.Lstat(dest.Abs); err == nil {
				item.Conflict = true
				item.ErrorCode = "target_exists"
				item.ErrorText = "destination already exists"
			} else if !os.IsNotExist(err) {
				item.Conflict = true
				item.ErrorCode = "operation_failed"
				item.ErrorText = err.Error()
			}
		default:
			item.Conflict = true
			item.ErrorCode = "invalid_request"
			item.ErrorText = "unsupported operation"
		}
		items = append(items, item)
	}
	return finalize(items), nil
}

func finalize(items []PlanItem) Plan {
	plan := Plan{Items: items}
	for _, item := range items {
		if item.Conflict {
			plan.HasConflict = true
			break
		}
	}
	return plan
}

func defaultPath(path string) string {
	if path == "" {
		return "."
	}
	return path
}

func errorCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errorsIs(err, roots.ErrUnknownRoot):
		return "unknown_root"
	case errorsIs(err, roots.ErrOutsideRoot):
		return "outside_root"
	case errorsIs(err, roots.ErrInvalidPath):
		return "invalid_path"
	default:
		return "operation_failed"
	}
}

func errorsIs(err, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			return false
		}
		err = u.Unwrap()
	}
	return false
}
