package ops

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/little6neko/filebutler/internal/roots"
)

type Planner struct {
	Resolver roots.Resolver
}

func (p Planner) Plan(ctx context.Context, req Request) (Plan, error) {
	if err := ctx.Err(); err != nil {
		return Plan{}, err
	}
	if !supportedOperation(req.Type) {
		return finalize([]PlanItem{{
			Operation: req.Type,
			Conflict:  true,
			ErrorCode: "invalid_request",
			ErrorText: "unsupported operation",
		}}), nil
	}
	var items []PlanItem
	if req.Type == OpMkdir {
		destPath := filepath.ToSlash(filepath.Join(defaultPath(req.DestPath), req.NewName))
		item := PlanItem{Operation: req.Type, DestRoot: req.DestRoot, DestPath: destPath}
		if _, err := p.Resolver.ResolveCreate(req.DestRoot, destPath); errorsIs(err, roots.ErrPathExists) {
			item.Conflict = true
			item.ErrorCode = "target_exists"
			item.ErrorText = "destination already exists"
		} else if err != nil {
			item.Conflict = true
			item.ErrorCode = errorCode(err)
			item.ErrorText = err.Error()
		}
		return finalize([]PlanItem{item}), nil
	}
	for _, src := range req.Sources {
		if err := ctx.Err(); err != nil {
			return Plan{}, err
		}
		item := PlanItem{Operation: req.Type, SourceRoot: req.SourceRoot, SourcePath: src}
		source, srcErr := resolveOperationSource(p.Resolver, req.SourceRoot, src)
		if srcErr != nil {
			item.Conflict = true
			if os.IsNotExist(srcErr) {
				item.ErrorCode = "missing_source"
				item.ErrorText = "source does not exist"
			} else {
				item.ErrorCode = errorCode(srcErr)
				item.ErrorText = srcErr.Error()
			}
			items = append(items, item)
			continue
		}
		info, statErr := os.Lstat(source.Actual.Abs)
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
		case OpMove, OpCopy:
			destPath := filepath.ToSlash(filepath.Join(defaultPath(req.DestPath), filepath.Base(src)))
			item.DestRoot = req.DestRoot
			item.DestPath = destPath
			dest, err := p.Resolver.ResolveCreate(req.DestRoot, destPath)
			if errorsIs(err, roots.ErrPathExists) {
				item.Conflict = true
				item.ErrorCode = "target_exists"
				item.ErrorText = "destination already exists"
			} else if err != nil {
				item.Conflict = true
				item.ErrorCode = errorCode(err)
				item.ErrorText = err.Error()
			} else if (req.Type == OpMove || req.Type == OpCopy) && info.IsDir() && pathInside(source.Actual.Abs, dest.Actual.Abs) {
				item.Conflict = true
				item.ErrorCode = "destination_inside_source"
				item.ErrorText = "destination cannot be inside the source directory"
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

func supportedOperation(operation OperationType) bool {
	switch operation {
	case OpMove, OpCopy, OpDelete, OpMkdir:
		return true
	default:
		return false
	}
}

func resolveOperationSource(resolver roots.Resolver, rootID string, rel string) (roots.MappedPath, error) {
	cleaned := filepath.Clean(defaultPath(rel))
	if cleaned == "." {
		return resolver.ResolveFollow(rootID, rel)
	}
	return resolver.ResolveEntry(rootID, rel)
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

func pathInside(parent, candidate string) bool {
	parent = filepath.Clean(parent)
	candidate = filepath.Clean(candidate)
	relative, err := filepath.Rel(parent, candidate)
	if err != nil {
		return false
	}
	return relative == "." || (relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)))
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
